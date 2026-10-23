-- Crescendo Fuel Rush: Fix request_question timeout handling
-- Replaces request_question with deadlock-free timeout transition

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
  IF NOT v_cfg.is_open OR now() < v_cfg.start_at OR now() >= v_cfg.end_at THEN
    RAISE EXCEPTION 'Race window is not active';
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
  SELECT * INTO v_issued FROM public.issued_questions 
   WHERE player_id = v_player_id AND answered_at IS NULL 
   ORDER BY issued_at DESC LIMIT 1;

  IF FOUND THEN
    IF (now() - v_issued.issued_at) < (v_cfg.question_time_ms * interval '1 millisecond') THEN
      -- Re-return the current question with its stored option order
      SELECT * INTO v_q FROM public.questions WHERE id = v_issued.question_id;
      SELECT jsonb_agg(v_q.options->(val::int) ORDER BY ord) INTO v_shuffled_options 
        FROM jsonb_array_elements_text(v_issued.option_order) WITH ORDINALITY AS t(val, ord);

      RETURN json_build_object(
        'questionId', v_q.id,
        'text', v_q.text,
        'options', v_shuffled_options
      );
    ELSE
      -- Timed out: mark as wrong, clear current question, and proceed to issue next question
      UPDATE public.issued_questions SET answered_at = now(), was_correct = false WHERE id = v_issued.id;
      UPDATE public.players SET 
        wrong_answers = wrong_answers + 1,
        current_question_id = NULL
      WHERE id = v_player_id;
    END IF;
  END IF;

  -- Pick a question not yet issued to this player
  SELECT id INTO v_selected_qid FROM public.questions 
   WHERE active = true AND id NOT IN (
     SELECT question_id FROM public.issued_questions WHERE player_id = v_player_id
   )
   ORDER BY random() LIMIT 1;

  -- Recycle if all questions have been seen
  IF v_selected_qid IS NULL THEN
    SELECT id INTO v_selected_qid FROM public.questions WHERE active = true ORDER BY random() LIMIT 1;
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
  INSERT INTO public.issued_questions (player_id, question_id, option_order, issued_at)
  VALUES (v_player_id, v_q.id, v_order, now());

  UPDATE public.players SET 
    current_question_id = v_q.id,
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
