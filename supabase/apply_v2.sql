-- ============================================================
-- Crescendo Fuel Rush: Complete V2 Schema & RPC Update
-- File: supabase/apply_v2.sql
-- Idempotent script for Supabase SQL Editor:
-- https://supabase.com/dashboard/project/bsaucqmsrxwibdvtrujb/sql
--
-- Features Included:
--   1. Branch & Year registration (COMPS, CSE, ECS, MECH, AIDS [4th yr only])
--   2. B4 Question Selection Algorithm (Difficulty curve, branch questions, 6-tier fallback)
--   3. Answer reveal on wrong answer or timeout with explanations
--   4. Scoped Leaderboard Tabs (ALL, MY BRANCH, MY YEAR)
--   5. Dynamic Speed Ramp & physical lap validation
--   6. Config feature flags
--   IMPORTANT: Race is permanently open (2020 to 2099). No window locks.
-- ============================================================

-- 1. Table Alterations
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS branch text NOT NULL DEFAULT 'COMPS';
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS year smallint NOT NULL DEFAULT 1;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS min_drive_ms_total bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_players_branch'
  ) THEN
    ALTER TABLE public.players ADD CONSTRAINT chk_players_branch
      CHECK (branch IN ('COMPS', 'CSE', 'ECS', 'MECH', 'AIDS'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_players_year'
  ) THEN
    ALTER TABLE public.players ADD CONSTRAINT chk_players_year
      CHECK (year BETWEEN 1 AND 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_players_aids_year'
  ) THEN
    ALTER TABLE public.players ADD CONSTRAINT chk_players_aids_year
      CHECK (NOT (branch = 'AIDS' AND year <> 4));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_players_leaderboard_scoped
  ON public.players (branch, laps DESC, correct_answers DESC, last_lap_at ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_players_leaderboard_year
  ON public.players (year, laps DESC, correct_answers DESC, last_lap_at ASC NULLS LAST);

ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS branches text[] NOT NULL DEFAULT ARRAY['ALL']::text[];
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS year_min smallint NOT NULL DEFAULT 1;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS year_max smallint NOT NULL DEFAULT 4;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS difficulty smallint NOT NULL DEFAULT 1;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS explanation text;

CREATE INDEX IF NOT EXISTS idx_questions_branches ON public.questions USING gin(branches);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON public.questions (difficulty);

ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS shuffled_options jsonb;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS chosen_index smallint;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS was_correct boolean;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS difficulty smallint;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS fallback_level smallint;

ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS branch_specific_ratio numeric NOT NULL DEFAULT 0.7;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS difficulty_curve jsonb NOT NULL DEFAULT '[[1, 10, [0.8, 0.2, 0.0]], [11, 25, [0.3, 0.5, 0.2]], [26, 45, [0.1, 0.4, 0.5]], [46, 9999, [0.0, 0.3, 0.7]]]'::jsonb;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS speed_step numeric NOT NULL DEFAULT 0.04;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS speed_cap numeric NOT NULL DEFAULT 1.5;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS lap_min_factor numeric NOT NULL DEFAULT 0.8;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS track_stages jsonb NOT NULL DEFAULT '[{"stage": 1, "startLap": 1, "endLap": 10}, {"stage": 2, "startLap": 11, "endLap": 25}, {"stage": 3, "startLap": 26, "endLap": 45}, {"stage": 4, "startLap": 46, "endLap": 9999}]'::jsonb;

-- Feature Flags
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS feature_branch_questions boolean NOT NULL DEFAULT true;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS feature_difficulty_curve boolean NOT NULL DEFAULT true;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS feature_speed_ramp boolean NOT NULL DEFAULT true;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS feature_track_stages boolean NOT NULL DEFAULT true;
ALTER TABLE public.game_config ADD COLUMN IF NOT EXISTS feature_answer_reveal boolean NOT NULL DEFAULT true;

-- Ensure game_config maintains permanently open state
UPDATE public.game_config
SET
  is_open = true,
  start_at = '2020-01-01 00:00:00+00',
  end_at = '2099-01-01 00:00:00+00';

-- 2. get_config() RPC
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
      'feature_answer_reveal', v_cfg.feature_answer_reveal
    )
  );
END;
$$;

-- 3. join_race(p_name, p_branch, p_year)
DROP FUNCTION IF EXISTS public.join_race(text);
DROP FUNCTION IF EXISTS public.join_race(text, text, smallint);
DROP FUNCTION IF EXISTS public.join_race(text, text, int);

CREATE OR REPLACE FUNCTION public.join_race(
  p_name text,
  p_branch text DEFAULT 'COMPS',
  p_year smallint DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_clean_name text;
  v_cfg record;
  v_player record;
  v_branch text;
  v_year smallint;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: valid auth session required';
  END IF;

  v_clean_name := trim(p_name);
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 16 THEN
    RAISE EXCEPTION 'Name must be between 2 and 16 characters';
  END IF;

  IF NOT (v_clean_name ~* '^[a-zA-Z0-9 ]+$') THEN
    RAISE EXCEPTION 'Name can only contain letters, numbers, and spaces';
  END IF;

  IF lower(v_clean_name) ~* '(admin|root|null|undefined|moderator|system)' THEN
    RAISE EXCEPTION 'Reserved or prohibited name chosen';
  END IF;

  v_branch := upper(trim(COALESCE(p_branch, 'COMPS')));
  IF v_branch NOT IN ('COMPS', 'CSE', 'ECS', 'MECH', 'AIDS') THEN
    RAISE EXCEPTION 'Invalid branch specified: %', p_branch;
  END IF;

  v_year := COALESCE(p_year, 1);
  IF v_year < 1 OR v_year > 4 THEN
    RAISE EXCEPTION 'Invalid year specified: %', p_year;
  END IF;

  IF v_branch = 'AIDS' AND v_year <> 4 THEN
    RAISE EXCEPTION 'AIDS branch is only open to 4th year students';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  IF NOT v_cfg.is_open THEN
    RAISE EXCEPTION 'Race registration is currently closed';
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id = v_player_id;
  IF NOT FOUND THEN
    INSERT INTO public.players (
      id, name, branch, year, joined_at, laps, correct_answers, wrong_answers, fuel_granted_ms, min_drive_ms_total
    ) VALUES (
      v_player_id, v_clean_name, v_branch, v_year, now(), 0, 0, 0, v_cfg.initial_fuel_ms, 0
    ) RETURNING * INTO v_player;
  ELSE
    UPDATE public.players
    SET name = v_clean_name
    WHERE id = v_player_id
    RETURNING * INTO v_player;
  END IF;

  RETURN json_build_object(
    'playerId', v_player.id,
    'name', v_player.name,
    'branch', v_player.branch,
    'year', v_player.year,
    'laps', v_player.laps,
    'correct', v_player.correct_answers
  );
END;
$$;

-- 4. request_question() with B4 algorithm
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
  v_q record;
  v_order jsonb;
  v_shuffled_options jsonb;
  v_selected_qid uuid;
  v_target_diff smallint := 1;
  v_target_branch text := 'ALL';
  v_fallback_level smallint := 0;
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

  -- Check active lockout
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
  v_fallback_level := 0;
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

  -- Step 1
  IF v_selected_qid IS NULL THEN
    v_fallback_level := 1;
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

  -- Step 2
  IF v_selected_qid IS NULL THEN
    v_fallback_level := 2;
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

  -- Step 3
  IF v_selected_qid IS NULL THEN
    v_fallback_level := 3;
    SELECT q.id INTO v_selected_qid
    FROM public.questions q
    WHERE q.active = true
      AND 'ALL' = ANY(q.branches)
      AND v_player.year BETWEEN q.year_min AND q.year_max
      AND abs(q.difficulty - v_target_diff) = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.issued_questions i WHERE i.player_id = v_player_id AND i.question_id = q.id
      )
    ORDER BY random() LIMIT 1;
  END IF;

  -- Step 4
  IF v_selected_qid IS NULL THEN
    v_fallback_level := 4;
    SELECT q.id INTO v_selected_qid
    FROM public.questions q
    WHERE q.active = true
      AND (v_player.branch = ANY(q.branches) OR 'ALL' = ANY(q.branches))
      AND v_player.year BETWEEN q.year_min AND q.year_max
      AND NOT EXISTS (
        SELECT 1 FROM public.issued_questions i WHERE i.player_id = v_player_id AND i.question_id = q.id
      )
    ORDER BY random() LIMIT 1;
  END IF;

  -- Step 5
  IF v_selected_qid IS NULL THEN
    v_fallback_level := 5;
    SELECT q.id INTO v_selected_qid
    FROM public.questions q
    WHERE q.active = true
    ORDER BY random() LIMIT 1;
  END IF;

  IF v_selected_qid IS NULL THEN
    RAISE EXCEPTION 'No active questions available in bank';
  END IF;

  SELECT * INTO v_q FROM public.questions WHERE id = v_selected_qid;

  SELECT jsonb_agg(idx) INTO v_order FROM (
    SELECT idx FROM unnest(ARRAY[0, 1, 2, 3]) AS idx ORDER BY random()
  ) t;

  SELECT jsonb_agg(v_q.options->(val::int) ORDER BY ord) INTO v_shuffled_options 
  FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS t(val, ord);

  INSERT INTO public.issued_questions (
    player_id, question_id, option_order, shuffled_options, difficulty, fallback_level, issued_at
  ) VALUES (
    v_player_id, v_selected_qid, v_order, v_shuffled_options, v_q.difficulty, v_fallback_level, now()
  );

  UPDATE public.players
  SET
    current_question_id = v_selected_qid,
    question_issued_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'questionId', v_q.id,
    'text', v_q.text,
    'options', v_shuffled_options,
    'difficulty', v_q.difficulty
  );
END;
$$;

-- 5. answer_question() with Answer Reveal
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

  SELECT (ord - 1)::int INTO v_shuffled_correct_index
  FROM jsonb_array_elements_text(v_issued.option_order) WITH ORDINALITY AS t(val, ord)
  WHERE (val::int) = v_q.correct_index
  LIMIT 1;

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
      'correctTotal', v_correct_total
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

-- 6. get_leaderboard(p_limit, p_scope) with Scoped Leaderboards
DROP FUNCTION IF EXISTS public.get_leaderboard(int);
DROP FUNCTION IF EXISTS public.get_leaderboard(int, text);

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_limit int DEFAULT 10,
  p_scope text DEFAULT 'ALL'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_player record;
  v_total int;
  v_top json;
  v_me json;
  v_norm_scope text;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NOT NULL THEN
    SELECT * INTO v_player FROM public.players WHERE id = v_player_id;
  END IF;

  v_norm_scope := upper(trim(COALESCE(p_scope, 'ALL')));

  WITH filtered_pool AS (
    SELECT *
    FROM public.players
    WHERE
      CASE
        WHEN v_norm_scope = 'BRANCH' AND v_player.branch IS NOT NULL THEN branch = v_player.branch
        WHEN v_norm_scope = 'YEAR' AND v_player.year IS NOT NULL THEN year = v_player.year
        ELSE true
      END
  ),
  ranked AS (
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY laps DESC, correct_answers DESC, last_lap_at ASC NULLS LAST, id ASC
      )::int AS rank,
      id,
      name,
      branch,
      year,
      laps,
      correct_answers AS correct
    FROM filtered_pool
  )
  SELECT
    (SELECT COUNT(*)::int FROM filtered_pool),
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'rank', rank,
            'name', name,
            'branch', branch,
            'year', year,
            'laps', laps,
            'correct', correct,
            'isMe', (v_player_id IS NOT NULL AND id = v_player_id)
          )
        )
        FROM (SELECT * FROM ranked LIMIT COALESCE(p_limit, 10)) t
      ),
      '[]'::json
    ),
    (
      SELECT json_build_object(
        'rank', rank,
        'name', name,
        'branch', branch,
        'year', year,
        'laps', laps,
        'correct', correct,
        'isMe', true
      )
      FROM ranked
      WHERE id = v_player_id
      LIMIT 1
    )
  INTO v_total, v_top, v_me;

  RETURN json_build_object(
    'top', v_top,
    'me', v_me,
    'totalPlayers', v_total,
    'scope', v_norm_scope
  );
END;
$$;

-- 7. submit_lap(p_lap_number, p_lap_time_ms) with Speed Ramp Validation
DROP FUNCTION IF EXISTS public.submit_lap(int, bigint);
DROP FUNCTION IF EXISTS public.submit_lap(int, int);

CREATE OR REPLACE FUNCTION public.submit_lap(p_lap_number int, p_lap_time_ms int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_cfg record;
  v_player record;
  v_time_since_last_ms bigint;
  v_speed_mult numeric;
  v_effective_min_lap_ms int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: valid auth session required';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  IF NOT v_cfg.is_open THEN
    RAISE EXCEPTION 'Race is currently paused';
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found in race';
  END IF;

  IF p_lap_number <= v_player.laps THEN
    RETURN json_build_object(
      'accepted', false,
      'laps', v_player.laps,
      'reason', 'Lap already recorded (duplicate or replay)'
    );
  END IF;

  IF p_lap_number > (v_player.laps + 1) THEN
    RETURN json_build_object(
      'accepted', false,
      'laps', v_player.laps,
      'reason', 'Lap sequence skipped'
    );
  END IF;

  IF COALESCE(v_cfg.feature_speed_ramp, true) THEN
    v_speed_mult := LEAST(1.0 + COALESCE(v_cfg.speed_step, 0.04) * (p_lap_number - 1), COALESCE(v_cfg.speed_cap, 1.5));
  ELSE
    v_speed_mult := 1.0;
  END IF;

  v_effective_min_lap_ms := round((COALESCE(v_cfg.min_lap_ms, 32000)::numeric) / v_speed_mult);

  IF p_lap_time_ms < v_effective_min_lap_ms THEN
    RETURN json_build_object(
      'accepted', false,
      'laps', v_player.laps,
      'reason', format('Lap time (%sms) faster than physical minimum (%sms at x%s speed)', p_lap_time_ms, v_effective_min_lap_ms, round(v_speed_mult, 2))
    );
  END IF;

  IF v_player.last_lap_at IS NOT NULL THEN
    v_time_since_last_ms := round(extract(epoch from (now() - v_player.last_lap_at)) * 1000);
    IF v_time_since_last_ms < (v_effective_min_lap_ms * 0.90) THEN
      RETURN json_build_object(
        'accepted', false,
        'laps', v_player.laps,
        'reason', 'Wall clock time since previous lap is impossible'
      );
    END IF;
  END IF;

  IF (COALESCE(v_player.min_drive_ms_total, 0) + v_effective_min_lap_ms) > (v_player.fuel_granted_ms * 1.05) THEN
    RETURN json_build_object(
      'accepted', false,
      'laps', v_player.laps,
      'reason', 'Fuel depleted: insufficient fuel for completed lap distance'
    );
  END IF;

  INSERT INTO public.laps (
    player_id, lap_number, lap_time_ms, created_at
  ) VALUES (
    v_player_id, p_lap_number, p_lap_time_ms, now()
  );

  UPDATE public.players
  SET
    laps = p_lap_number,
    last_lap_at = now(),
    min_drive_ms_total = COALESCE(min_drive_ms_total, 0) + v_effective_min_lap_ms
  WHERE id = v_player_id;

  RETURN json_build_object(
    'accepted', true,
    'laps', p_lap_number
  );
END;
$$;

-- 8. Grants
GRANT EXECUTE ON FUNCTION public.get_config() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_race(text, text, smallint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_question() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.answer_question(uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lap(int, int) TO anon, authenticated;

-- 9. Check Status Confirmation
SELECT
  is_open,
  start_at,
  end_at,
  feature_branch_questions,
  feature_difficulty_curve,
  feature_speed_ramp,
  feature_track_stages,
  feature_answer_reveal,
  'CRESCENDO FUEL RUSH V2 READY' as status
FROM public.game_config;
