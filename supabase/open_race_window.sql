-- ============================================================
-- Crescendo Fuel Rush: Complete Hotfix & Always-Open Race
-- Fixes:
--   1. "operator does not exist: jsonb -> bigint" in request_question
--   2. PGRST203 candidate function conflict for submit_lap
--   3. Keeps race permanently open without timing restrictions
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/bsaucqmsrxwibdvtrujb/sql
-- ============================================================

-- 1. Ensure columns exist on issued_questions
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS shuffled_options jsonb;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS chosen_index smallint;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS was_correct boolean;

-- 2. Permanently Open Configuration (Start: 2020, End: 2099)
UPDATE public.game_config
SET
  is_open = true,
  start_at = '2020-01-01 00:00:00+00',
  end_at = '2099-01-01 00:00:00+00';

-- 3. Update join_race()
CREATE OR REPLACE FUNCTION public.join_race(p_name text)
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

  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  IF NOT v_cfg.is_open THEN
    RAISE EXCEPTION 'Race registration is currently closed';
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id = v_player_id;
  IF NOT FOUND THEN
    INSERT INTO public.players (
      id, name, joined_at, laps, correct_answers, wrong_answers, fuel_granted_ms
    ) VALUES (
      v_player_id, v_clean_name, now(), 0, 0, 0, v_cfg.initial_fuel_ms
    ) RETURNING * INTO v_player;
  ELSE
    UPDATE public.players SET name = v_clean_name WHERE id = v_player_id RETURNING * INTO v_player;
  END IF;

  RETURN json_build_object(
    'playerId', v_player.id,
    'name', v_player.name,
    'laps', v_player.laps,
    'correct', v_player.correct_answers
  );
END;
$$;

-- 4. Update request_question() with SAFE INTEGER INDEXING (NO jsonb -> bigint)
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
      -- Mark timed out question answered cleanly
      UPDATE public.issued_questions
      SET answered_at = now(), was_correct = false
      WHERE id = v_issued.id;

      -- Apply wrong answer lockout penalty to player
      UPDATE public.players
      SET
        wrong_answers = wrong_answers + 1,
        locked_until = now() + (v_cfg.wrong_lockout_ms * interval '1 millisecond'),
        current_question_id = NULL
      WHERE id = v_player_id;
    ELSE
      -- Still active and within question time limit: re-return existing question
      SELECT * INTO v_q FROM public.questions WHERE id = v_issued.question_id;

      -- Reconstruct shuffled options preserving order using explicit (val::int) cast
      SELECT jsonb_agg(v_q.options->(val::int) ORDER BY ord) INTO v_shuffled_options 
      FROM jsonb_array_elements_text(v_issued.option_order) WITH ORDINALITY AS t(val, ord);

      RETURN json_build_object(
        'questionId', v_q.id,
        'text', v_q.text,
        'options', v_shuffled_options
      );
    END IF;
  END IF;

  -- Pick an unseen question
  SELECT id INTO v_selected_qid
  FROM public.questions q
  WHERE q.active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.issued_questions i
      WHERE i.player_id = v_player_id AND i.question_id = q.id
    )
  ORDER BY random()
  LIMIT 1;

  -- If player has seen all questions, recycle from active pool
  IF v_selected_qid IS NULL THEN
    SELECT id INTO v_selected_qid
    FROM public.questions
    WHERE active = true
    ORDER BY random()
    LIMIT 1;
  END IF;

  IF v_selected_qid IS NULL THEN
    RAISE EXCEPTION 'No active questions available in bank';
  END IF;

  SELECT * INTO v_q FROM public.questions WHERE id = v_selected_qid;

  -- Shuffle options [0, 1, 2, 3]
  SELECT jsonb_agg(idx) INTO v_order FROM (
    SELECT idx FROM unnest(ARRAY[0, 1, 2, 3]) AS idx ORDER BY random()
  ) t;

  -- Build shuffled options array preserving randomized order with safe integer casting
  SELECT jsonb_agg(v_q.options->(val::int) ORDER BY ord) INTO v_shuffled_options 
  FROM jsonb_array_elements_text(v_order) WITH ORDINALITY AS t(val, ord);

  -- Record issued question
  INSERT INTO public.issued_questions (
    player_id, question_id, option_order, shuffled_options, issued_at
  ) VALUES (
    v_player_id, v_selected_qid, v_order, v_shuffled_options, now()
  );

  UPDATE public.players
  SET
    current_question_id = v_selected_qid,
    question_issued_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'questionId', v_q.id,
    'text', v_q.text,
    'options', v_shuffled_options
  );
END;
$$;

-- 5. Update answer_question()
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
  v_is_correct boolean;
  v_elapsed_ms numeric;
  v_laps int;
  v_correct_total int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: valid auth session required';
  END IF;

  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  IF NOT v_cfg.is_open THEN
    RAISE EXCEPTION 'Race is currently paused';
  END IF;

  -- Find issued question
  SELECT * INTO v_issued FROM public.issued_questions 
   WHERE player_id = v_player_id AND question_id = p_question_id
   ORDER BY issued_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question was not issued to this player';
  END IF;

  -- Handle idempotency / repeated submission
  IF v_issued.answered_at IS NOT NULL THEN
    SELECT laps, correct_answers INTO v_laps, v_correct_total FROM public.players WHERE id = v_player_id;
    RETURN json_build_object(
      'correct', v_issued.was_correct,
      'fuelGrantedMs', (CASE WHEN v_issued.was_correct THEN v_cfg.fuel_per_correct_ms ELSE 0 END),
      'laps', v_laps,
      'correctTotal', v_correct_total
    );
  END IF;

  -- Check timeout + 2000ms grace period
  v_elapsed_ms := EXTRACT(EPOCH FROM (now() - v_issued.issued_at)) * 1000;
  IF v_elapsed_ms > (v_cfg.question_time_ms + 2000) THEN
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
      'correctTotal', v_correct_total
    );
  END IF;

  -- Map chosen index back to original option index
  SELECT * INTO v_q FROM public.questions WHERE id = p_question_id;
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
      'correctTotal', v_correct_total
    );
  END IF;
END;
$$;

-- 6. Clean and recreate submit_lap to avoid PGRST203 function overload conflict
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

  -- Anti-cheat rule 1: Sequential lap progression
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

  -- Anti-cheat rule 2: Minimum lap duration threshold
  IF p_lap_time_ms < v_cfg.min_lap_ms THEN
    RETURN json_build_object(
      'accepted', false,
      'laps', v_player.laps,
      'reason', format('Lap time (%sms) faster than physical minimum (%sms)', p_lap_time_ms, v_cfg.min_lap_ms)
    );
  END IF;

  -- Anti-cheat rule 3: Server wall-clock elapsed time verification
  IF v_player.last_lap_at IS NOT NULL THEN
    v_time_since_last_ms := round(extract(epoch from (now() - v_player.last_lap_at)) * 1000);
    IF v_time_since_last_ms < (v_cfg.min_lap_ms * 0.85) THEN
      RETURN json_build_object(
        'accepted', false,
        'laps', v_player.laps,
        'reason', 'Wall clock time since previous lap is impossible'
      );
    END IF;
  END IF;

  -- Accept lap
  INSERT INTO public.laps (
    player_id, lap_number, lap_time_ms, created_at
  ) VALUES (
    v_player_id, p_lap_number, p_lap_time_ms, now()
  );

  UPDATE public.players
  SET
    laps = p_lap_number,
    last_lap_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'accepted', true,
    'laps', p_lap_number
  );
END;
$$;

-- 7. Execute Grants
GRANT EXECUTE ON FUNCTION public.join_race(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_question() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.answer_question(uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lap(int, int) TO anon, authenticated;

-- 8. Confirm configuration
SELECT
  is_open,
  start_at,
  end_at,
  now() as server_time,
  'RACE IS ALWAYS OPEN AND ACTIVE' as status
FROM public.game_config;
