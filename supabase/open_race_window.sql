-- Crescendo Fuel Rush: Keep Race Always Open
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/bsaucqmsrxwibdvtrujb/sql

-- 1. Permanently Open Configuration (Start: 2020, End: 2099)
UPDATE public.game_config
SET
  is_open = true,
  start_at = '2020-01-01 00:00:00+00',
  end_at = '2099-01-01 00:00:00+00';

-- 2. Update join_race() to remove hardcoded start/finish window constraints
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

-- 3. Update request_question() to allow questions whenever race is open
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
    IF now() > (v_issued.issued_at + ((v_cfg.question_time_ms / 1000.0) * interval '1 second')) THEN
      -- Mark timed out question answered cleanly without rolling back
      UPDATE public.issued_questions
      SET answered_at = now()
      WHERE player_id = v_player_id AND question_id = v_issued.question_id;

      -- Apply wrong answer lockout penalty to player
      UPDATE public.players
      SET
        wrong_answers = wrong_answers + 1,
        locked_until = now() + ((v_cfg.wrong_lockout_ms / 1000.0) * interval '1 second')
      WHERE id = v_player_id;
    ELSE
      -- Still active and within question time limit: re-return existing question
      SELECT * INTO v_q FROM public.questions WHERE id = v_issued.question_id;
      RETURN json_build_object(
        'questionId', v_q.id,
        'text', v_q.text,
        'options', v_issued.shuffled_options
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

  -- If player has seen all 60 questions, recycle from active pool
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

  -- Randomly shuffle options 0, 1, 2, 3
  WITH shuffled AS (
    SELECT elem - 1 as orig_idx
    FROM jsonb_array_elements_text('["1","2","3","4"]'::jsonb) WITH ORDINALITY arr(val, elem)
    ORDER BY random()
  )
  SELECT
    jsonb_agg(orig_idx),
    jsonb_agg(v_q.options->orig_idx)
  INTO v_order, v_shuffled_options
  FROM shuffled;

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

-- 4. Update submit_lap() to allow laps whenever race is open
CREATE OR REPLACE FUNCTION public.submit_lap(p_lap_number int, p_lap_time_ms bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_cfg record;
  v_player record;
  v_last_lap timestamptz;
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

-- Grants
GRANT EXECUTE ON FUNCTION public.join_race(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_question() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lap(int, bigint) TO anon, authenticated;

-- Confirm configuration is active
SELECT
  is_open,
  start_at,
  end_at,
  now() as server_time,
  'RACE IS ALWAYS OPEN AND ACTIVE' as status
FROM public.game_config;
