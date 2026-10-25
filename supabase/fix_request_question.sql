-- ============================================================
-- FIX: request_question() jsonb -> bigint operator bug
-- Run this in your Supabase SQL Editor
-- ============================================================

ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS shuffled_options jsonb;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS chosen_index smallint;
ALTER TABLE public.issued_questions ADD COLUMN IF NOT EXISTS was_correct boolean;

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

GRANT EXECUTE ON FUNCTION public.request_question() TO anon, authenticated;
