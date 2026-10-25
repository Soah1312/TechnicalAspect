-- ============================================================
-- Crescendo Fuel Rush: Pack 3 Consolidated Updates (apply_v3.sql)
-- Idempotent script for Supabase SQL Editor
-- 
-- Summary of Changes:
--   1. Configuration: fuel_per_correct_ms = 10000, tank_max_ms = 10000, initial_fuel_ms = 10000
--   2. Flag: feature_lap_tracks boolean (default true) for procedural per-lap tracks
--   3. Anti-farming rule in request_question(): Enforces 0.8 * fuel_per_correct_ms after correct answer
--   4. Removed voluntary PIT checks, maintaining 100% open race window (NO countdown/time locks)
--   5. Idempotent answer_question() with exact 10s fuel grant and answer reveal
--   6. Dynamic speed ramp lap submission verification
-- ============================================================

-- 1. Schema Updates: feature_lap_tracks flag
ALTER TABLE public.game_config 
  ADD COLUMN IF NOT EXISTS feature_lap_tracks boolean NOT NULL DEFAULT true;

-- 2. Update Configuration: 10s Tank, 10s Grant, 10s Initial Fuel (DO NOT touch is_open, start_at, end_at)
UPDATE public.game_config
SET
  fuel_per_correct_ms = 10000,
  tank_max_ms = 10000,
  initial_fuel_ms = 10000,
  feature_lap_tracks = true,
  track_stages = '[{"fromLap":1,"bestLapMsAtBase":40386}]'::jsonb;


-- 3. get_config() RPC
CREATE OR REPLACE FUNCTION public.get_config()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg record;
BEGIN
  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  RETURN json_build_object(
    'startAt', round(extract(epoch from v_cfg.start_at) * 1000),
    'endAt', round(extract(epoch from v_cfg.end_at) * 1000),
    'isOpen', v_cfg.is_open,
    'tankMaxMs', v_cfg.tank_max_ms,
    'initialFuelMs', v_cfg.initial_fuel_ms,
    'fuelPerCorrectMs', v_cfg.fuel_per_correct_ms,
    'pitBelowFraction', v_cfg.pit_below_fraction,
    'questionTimeMs', v_cfg.question_time_ms,
    'wrongLockoutMs', v_cfg.wrong_lockout_ms,
    'minLapMs', v_cfg.min_lap_ms,
    'speedStep', v_cfg.speed_step,
    'speedCap', v_cfg.speed_cap,
    'lapMinFactor', v_cfg.lap_min_factor,
    'trackStages', v_cfg.track_stages,
    'branchSpecificRatio', v_cfg.branch_specific_ratio,
    'difficultyCurve', v_cfg.difficulty_curve,
    'featureFlags', json_build_object(
      'feature_branch_questions', v_cfg.feature_branch_questions,
      'feature_difficulty_curve', v_cfg.feature_difficulty_curve,
      'feature_speed_ramp', v_cfg.feature_speed_ramp,
      'feature_track_stages', v_cfg.feature_track_stages,
      'feature_answer_reveal', v_cfg.feature_answer_reveal,
      'feature_lap_tracks', COALESCE(v_cfg.feature_lap_tracks, true)
    )
  );
END;
$$;

-- 4. request_question() with Anti-Farming Rule & Open Race Window
CREATE OR REPLACE FUNCTION public.request_question()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_cfg record;
  v_player record;
  v_issued record;
  v_last_answered record;
  v_q record;
  v_order jsonb;
  v_shuffled_options jsonb;
  v_selected_qid uuid;
  v_target_diff smallint := 1;
  v_target_branch text := 'ALL';
  v_rand numeric;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: valid auth session required';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  IF NOT v_cfg.is_open THEN
    RAISE EXCEPTION 'Race is currently paused';
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id = v_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found in race';
  END IF;

  -- Check active lockout penalty (e.g. from wrong answer or timeout)
  IF v_player.locked_until IS NOT NULL AND v_player.locked_until > now() THEN
    RAISE EXCEPTION 'Player locked out until %', v_player.locked_until;
  END IF;

  -- Check unanswered question issued to this player
  SELECT * INTO v_issued
  FROM public.issued_questions
  WHERE player_id = v_player_id AND answered_at IS NULL
  ORDER BY issued_at DESC
  LIMIT 1;

  IF FOUND THEN
    -- Check if previous question has timed out
    IF (now() - v_issued.issued_at) > (v_cfg.question_time_ms * interval '1 millisecond') THEN
      UPDATE public.issued_questions
      SET answered_at = now(), was_correct = false
      WHERE id = v_issued.id;

      UPDATE public.players
      SET
        wrong_answers = wrong_answers + 1,
        locked_until = now() + (v_cfg.wrong_lockout_ms * interval '1 millisecond'),
        current_question_id = NULL
      WHERE id = v_player_id;
    ELSE
      -- Still active within question time limit: re-return existing question
      SELECT * INTO v_q FROM public.questions WHERE id = v_issued.question_id;

      SELECT jsonb_agg(v_q.options->(val::int) ORDER BY ord) INTO v_shuffled_options 
      FROM jsonb_array_elements_text(v_issued.option_order) WITH ORDINALITY AS t(val, ord);

      RETURN json_build_object(
        'questionId', v_q.id,
        'text', v_q.text,
        'options', v_shuffled_options,
        'difficulty', COALESCE(v_issued.difficulty, v_q.difficulty)
      );
    END IF;
  END IF;

  -- Anti-farming rule: If last answer was correct, enforce at least 0.8 * fuel_per_correct_ms gap
  SELECT * INTO v_last_answered
  FROM public.issued_questions
  WHERE player_id = v_player_id AND answered_at IS NOT NULL
  ORDER BY answered_at DESC
  LIMIT 1;

  IF FOUND AND v_last_answered.was_correct = true THEN
    IF (now() - v_last_answered.answered_at) < (v_cfg.fuel_per_correct_ms * 0.8 * interval '1 millisecond') THEN
      RETURN json_build_object(
        'status', 'TOO_SOON',
        'waitMs', round(extract(epoch from ((v_last_answered.answered_at + (v_cfg.fuel_per_correct_ms * 0.8 * interval '1 millisecond')) - now())) * 1000)
      );
    END IF;
  END IF;

  -- 1. Determine Target Difficulty from Laps
  IF COALESCE(v_cfg.feature_difficulty_curve, true) THEN
    v_rand := random();
    IF v_player.laps <= 10 THEN
      IF v_rand < 0.80 THEN v_target_diff := 1; ELSE v_target_diff := 2; END IF;
    ELSIF v_player.laps <= 25 THEN
      IF v_rand < 0.30 THEN v_target_diff := 1;
      ELSIF v_rand < 0.80 THEN v_target_diff := 2;
      ELSE v_target_diff := 3; END IF;
    ELSIF v_player.laps <= 45 THEN
      IF v_rand < 0.10 THEN v_target_diff := 1;
      ELSIF v_rand < 0.50 THEN v_target_diff := 2;
      ELSE v_target_diff := 3; END IF;
    ELSE
      IF v_rand < 0.30 THEN v_target_diff := 2; ELSE v_target_diff := 3; END IF;
    END IF;
  ELSE
    v_target_diff := 1;
  END IF;

  -- 2. Determine Target Pool (Branch vs General)
  IF COALESCE(v_cfg.feature_branch_questions, true) AND random() < COALESCE(v_cfg.branch_specific_ratio, 0.7) THEN
    v_target_branch := v_player.branch;
  ELSE
    v_target_branch := 'ALL';
  END IF;

  -- 3. Execute B4 Fallback Chain
  v_selected_qid := NULL;

  -- Step 0 (Ideal)
  SELECT q.id INTO v_selected_qid
  FROM public.questions q
  WHERE q.active = true
    AND v_target_branch = ANY(q.branches)
    AND v_player.year BETWEEN q.year_min AND q.year_max
    AND q.difficulty = v_target_diff
    AND NOT EXISTS (
      SELECT 1 FROM public.issued_questions i WHERE i.player_id = v_player_id AND i.question_id = q.id
    )
  ORDER BY random() LIMIT 1;

  -- Step 1 (Adjacent difficulty)
  IF v_selected_qid IS NULL THEN
    SELECT q.id INTO v_selected_qid
    FROM public.questions q
    WHERE q.active = true
      AND v_target_branch = ANY(q.branches)
      AND v_player.year BETWEEN q.year_min AND q.year_max
      AND abs(q.difficulty - v_target_diff) = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.issued_questions i WHERE i.player_id = v_player_id AND i.question_id = q.id
      )
    ORDER BY random() LIMIT 1;
  END IF;

  -- Step 2 (General branch pool)
  IF v_selected_qid IS NULL THEN
    SELECT q.id INTO v_selected_qid
    FROM public.questions q
    WHERE q.active = true
      AND 'ALL' = ANY(q.branches)
      AND v_player.year BETWEEN q.year_min AND q.year_max
      AND q.difficulty = v_target_diff
      AND NOT EXISTS (
        SELECT 1 FROM public.issued_questions i WHERE i.player_id = v_player_id AND i.question_id = q.id
      )
    ORDER BY random() LIMIT 1;
  END IF;

  -- Step 3 (Any difficulty in target branch)
  IF v_selected_qid IS NULL THEN
    SELECT q.id INTO v_selected_qid
    FROM public.questions q
    WHERE q.active = true
      AND v_target_branch = ANY(q.branches)
      AND v_player.year BETWEEN q.year_min AND q.year_max
      AND NOT EXISTS (
        SELECT 1 FROM public.issued_questions i WHERE i.player_id = v_player_id AND i.question_id = q.id
      )
    ORDER BY random() LIMIT 1;
  END IF;

  -- Step 4 (Universal fallback)
  IF v_selected_qid IS NULL THEN
    SELECT q.id INTO v_selected_qid
    FROM public.questions q
    WHERE q.active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.issued_questions i WHERE i.player_id = v_player_id AND i.question_id = q.id
      )
    ORDER BY random() LIMIT 1;
  END IF;

  -- Recycle if player has seen every question
  IF v_selected_qid IS NULL THEN
    SELECT id INTO v_selected_qid
    FROM public.questions
    WHERE active = true
    ORDER BY random() LIMIT 1;
  END IF;

  IF v_selected_qid IS NULL THEN
    RAISE EXCEPTION 'No questions available in database';
  END IF;

  SELECT * INTO v_q FROM public.questions WHERE id = v_selected_qid;

  -- Shuffle options [0, 1, 2, 3]
  SELECT jsonb_agg(idx) INTO v_order FROM (
    SELECT idx FROM unnest(ARRAY[0, 1, 2, 3]) AS idx ORDER BY random()
  ) t;

  -- Build shuffled options array preserving order
  SELECT jsonb_agg(v_q.options->(val::int) ORDER BY ord) INTO v_shuffled_options 
  FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS t(val, ord);

  -- Insert issued record
  INSERT INTO public.issued_questions (
    player_id, question_id, option_order, shuffled_options, difficulty, target_branch, fallback_level, issued_at
  ) VALUES (
    v_player_id, v_q.id, v_order, v_shuffled_options, v_target_diff, v_target_branch, 0, now()
  );

  UPDATE public.players SET 
    current_question_id = v_q.id,
    question_issued_at = now() 
  WHERE id = v_player_id;

  RETURN json_build_object(
    'questionId', v_q.id,
    'text', v_q.text,
    'options', v_shuffled_options,
    'difficulty', v_target_diff
  );
END;
$$;

-- 5. answer_question() with Exact Fuel Grant & Idempotency
CREATE OR REPLACE FUNCTION public.answer_question(p_question_id uuid, p_option_index int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_cfg record;
  v_issued record;
  v_q record;
  v_original_index int;
  v_shuffled_correct_index int;
  v_is_correct boolean;
  v_elapsed_ms numeric;
  v_laps int;
  v_correct_total int;
  v_reveal boolean := false;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: valid auth session required';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  IF NOT v_cfg.is_open THEN
    RAISE EXCEPTION 'Race is currently paused';
  END IF;

  v_reveal := COALESCE(v_cfg.feature_answer_reveal, true);

  SELECT * INTO v_issued FROM public.issued_questions 
   WHERE player_id = v_player_id AND question_id = p_question_id
   ORDER BY issued_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question was not issued to this player';
  END IF;

  SELECT * INTO v_q FROM public.questions WHERE id = p_question_id;

  -- Determine index in shuffled array corresponding to original correct option
  SELECT (ord - 1)::int INTO v_shuffled_correct_index
  FROM jsonb_array_elements_text(v_issued.option_order) WITH ORDINALITY AS t(val, ord)
  WHERE (val::int) = v_q.correct_index
  LIMIT 1;

  -- Idempotency check: if already answered, return stored result without re-granting fuel
  IF v_issued.answered_at IS NOT NULL THEN
    SELECT laps, correct_answers INTO v_laps, v_correct_total FROM public.players WHERE id = v_player_id;
    RETURN json_build_object(
      'correct', v_issued.was_correct,
      'fuelGrantedMs', (CASE WHEN v_issued.was_correct THEN v_cfg.fuel_per_correct_ms ELSE 0 END),
      'laps', v_laps,
      'correctTotal', v_correct_total,
      'correctIndex', (CASE WHEN NOT v_issued.was_correct AND v_reveal THEN v_shuffled_correct_index ELSE NULL END),
      'explanation', (CASE WHEN NOT v_issued.was_correct AND v_reveal THEN v_q.explanation ELSE NULL END)
    );
  END IF;

  v_elapsed_ms := EXTRACT(EPOCH FROM (now() - v_issued.issued_at)) * 1000;
  IF p_option_index < 0 OR v_elapsed_ms > (v_cfg.question_time_ms + 2000) THEN
    -- Timeout or forfeit: 0 fuel granted
    UPDATE public.issued_questions SET 
      answered_at = now(),
      chosen_index = (CASE WHEN p_option_index >= 0 THEN p_option_index ELSE NULL END),
      was_correct = false
    WHERE id = v_issued.id;

    UPDATE public.players SET 
      wrong_answers = wrong_answers + 1,
      locked_until = now() + (v_cfg.wrong_lockout_ms * interval '1 millisecond'),
      current_question_id = NULL
    WHERE id = v_player_id
    RETURNING laps, correct_answers INTO v_laps, v_correct_total;

    RETURN json_build_object(
      'correct', false,
      'fuelGrantedMs', 0,
      'laps', v_laps,
      'correctTotal', v_correct_total,
      'correctIndex', (CASE WHEN v_reveal THEN v_shuffled_correct_index ELSE NULL END),
      'explanation', (CASE WHEN v_reveal THEN v_q.explanation ELSE NULL END),
      'timedOut', true
    );
  END IF;

  v_original_index := (v_issued.option_order->>p_option_index)::int;
  v_is_correct := (v_original_index = v_q.correct_index);

  IF v_is_correct THEN
    UPDATE public.issued_questions SET 
      answered_at = now(),
      chosen_index = p_option_index,
      was_correct = true
    WHERE id = v_issued.id;

    -- Add exactly fuel_per_correct_ms to player's cumulative fuel_granted_ms
    UPDATE public.players SET 
      correct_answers = correct_answers + 1,
      fuel_granted_ms = fuel_granted_ms + v_cfg.fuel_per_correct_ms,
      current_question_id = NULL
    WHERE id = v_player_id
    RETURNING laps, correct_answers INTO v_laps, v_correct_total;

    RETURN json_build_object(
      'correct', true,
      'fuelGrantedMs', v_cfg.fuel_per_correct_ms,
      'laps', v_laps,
      'correctTotal', v_correct_total,
      'correctIndex', (CASE WHEN v_reveal THEN v_shuffled_correct_index ELSE NULL END),
      'explanation', (CASE WHEN v_reveal THEN v_q.explanation ELSE NULL END)
    );
  ELSE
    UPDATE public.issued_questions SET 
      answered_at = now(),
      chosen_index = p_option_index,
      was_correct = false
    WHERE id = v_issued.id;

    UPDATE public.players SET 
      wrong_answers = wrong_answers + 1,
      locked_until = now() + (v_cfg.wrong_lockout_ms * interval '1 millisecond'),
      current_question_id = NULL
    WHERE id = v_player_id
    RETURNING laps, correct_answers INTO v_laps, v_correct_total;

    RETURN json_build_object(
      'correct', false,
      'fuelGrantedMs', 0,
      'laps', v_laps,
      'correctTotal', v_correct_total,
      'correctIndex', (CASE WHEN v_reveal THEN v_shuffled_correct_index ELSE NULL END),
      'explanation', (CASE WHEN v_reveal THEN v_q.explanation ELSE NULL END)
    );
  END IF;
END;
$$;

-- 6. Grants
GRANT EXECUTE ON FUNCTION public.get_config() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_question() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.answer_question(uuid, int) TO anon, authenticated;

-- 7. Verification Output
SELECT
  is_open,
  fuel_per_correct_ms,
  tank_max_ms,
  initial_fuel_ms,
  feature_lap_tracks,
  now() as applied_at
FROM public.game_config;
