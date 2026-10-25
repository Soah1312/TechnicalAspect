-- Safe for anonymous viewers; stable ordering and bounded result size.
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
  v_player public.players%ROWTYPE;
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
          ) ORDER BY rank
        )
        FROM (SELECT * FROM ranked ORDER BY rank LIMIT greatest(1, least(COALESCE(p_limit, 10), 100))) t
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

GRANT EXECUTE ON FUNCTION public.get_leaderboard(int, text) TO anon, authenticated;
