-- Crescendo Fuel Rush Stage 4 Database Schema & RPCs
-- Security: Strict RLS with no public table policies, all mutations & reads through SECURITY DEFINER RPCs

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Game Config Table
CREATE TABLE IF NOT EXISTS public.game_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  tank_max_ms int NOT NULL DEFAULT 30000,
  initial_fuel_ms int NOT NULL DEFAULT 30000,
  fuel_per_correct_ms int NOT NULL DEFAULT 20000,
  pit_below_fraction numeric NOT NULL DEFAULT 0.5,
  question_time_ms int NOT NULL DEFAULT 15000,
  wrong_lockout_ms int NOT NULL DEFAULT 3000,
  min_lap_ms int NOT NULL DEFAULT 36000
);

-- Seed single game_config row with Stage 4 parameters
INSERT INTO public.game_config (
  id, start_at, end_at, is_open, tank_max_ms, initial_fuel_ms,
  fuel_per_correct_ms, pit_below_fraction, question_time_ms, wrong_lockout_ms, min_lap_ms
) VALUES (
  1,
  '2026-10-26 13:15:00+05:30',
  '2026-10-26 13:45:00+05:30',
  true,
  30000,
  30000,
  20000,
  0.5,
  15000,
  3000,
  36000
) ON CONFLICT (id) DO UPDATE SET
  start_at = EXCLUDED.start_at,
  end_at = EXCLUDED.end_at,
  is_open = EXCLUDED.is_open,
  tank_max_ms = EXCLUDED.tank_max_ms,
  initial_fuel_ms = EXCLUDED.initial_fuel_ms,
  fuel_per_correct_ms = EXCLUDED.fuel_per_correct_ms,
  pit_below_fraction = EXCLUDED.pit_below_fraction,
  question_time_ms = EXCLUDED.question_time_ms,
  wrong_lockout_ms = EXCLUDED.wrong_lockout_ms,
  min_lap_ms = EXCLUDED.min_lap_ms;

-- 2. Players Table
CREATE TABLE IF NOT EXISTS public.players (
  id uuid PRIMARY KEY, -- equals auth.uid()
  name text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  laps int NOT NULL DEFAULT 0,
  correct_answers int NOT NULL DEFAULT 0,
  wrong_answers int NOT NULL DEFAULT 0,
  last_lap_at timestamptz,
  fuel_granted_ms bigint NOT NULL DEFAULT 0,
  current_question_id uuid,
  question_issued_at timestamptz,
  locked_until timestamptz
);

-- 3. Questions Table
CREATE TABLE IF NOT EXISTS public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  options jsonb NOT NULL,
  correct_index smallint NOT NULL CHECK (correct_index >= 0 AND correct_index <= 3),
  active boolean NOT NULL DEFAULT true
);

-- 4. Issued Questions Table
CREATE TABLE IF NOT EXISTS public.issued_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  option_order jsonb NOT NULL, -- array of original indices shown to player, e.g. [2, 0, 3, 1]
  issued_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  chosen_index smallint,
  was_correct boolean
);

-- 5. Indexes for Leaderboard Ordering and Query Optimization
CREATE INDEX IF NOT EXISTS idx_players_leaderboard 
  ON public.players (laps DESC, correct_answers DESC, last_lap_at ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_issued_questions_player 
  ON public.issued_questions (player_id, question_id);

CREATE INDEX IF NOT EXISTS idx_issued_questions_unanswered 
  ON public.issued_questions (player_id) WHERE answered_at IS NULL;

-- 6. Row Level Security: Enforce RLS on all tables without public policies
ALTER TABLE public.game_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issued_questions ENABLE ROW LEVEL SECURITY;

-- Revoke default privileges from anon and authenticated on raw tables & sequences
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;


-- ============================================================================
-- 7. SECURITY DEFINER RPC FUNCTIONS
-- ============================================================================

-- A. get_config()
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game config not initialized';
  END IF;

  RETURN json_build_object(
    'startAt', (EXTRACT(EPOCH FROM v_cfg.start_at) * 1000)::bigint,
    'endAt', (EXTRACT(EPOCH FROM v_cfg.end_at) * 1000)::bigint,
    'isOpen', v_cfg.is_open,
    'tankMaxMs', v_cfg.tank_max_ms,
    'initialFuelMs', v_cfg.initial_fuel_ms,
    'fuelPerCorrectMs', v_cfg.fuel_per_correct_ms,
    'pitBelowFraction', v_cfg.pit_below_fraction::float,
    'questionTimeMs', v_cfg.question_time_ms,
    'wrongLockoutMs', v_cfg.wrong_lockout_ms,
    'minLapMs', v_cfg.min_lap_ms
  );
END;
$$;

-- B. get_server_time()
CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;
$$;

-- C. join_race(p_name text)
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
    RAISE EXCEPTION 'Registration is currently closed';
  END IF;

  IF now() >= v_cfg.end_at THEN
    RAISE EXCEPTION 'Race has already ended';
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

-- D. request_question()
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

  -- Check lockout
  IF v_player.locked_until IS NOT NULL AND v_player.locked_until > now() THEN
    RAISE EXCEPTION 'Player locked out until %', v_player.locked_until;
  END IF;

  -- Check unanswered question issued within question_time_ms
  SELECT * INTO v_issued FROM public.issued_questions 
   WHERE player_id = v_player_id AND answered_at IS NULL 
   ORDER BY issued_at DESC LIMIT 1;

  IF FOUND THEN
    IF (now() - v_issued.issued_at) < (v_cfg.question_time_ms * interval '1 millisecond') THEN
      -- Re-return the current question with its stored option order
      SELECT * INTO v_q FROM public.questions WHERE id = v_issued.question_id;
      SELECT jsonb_agg(v_q.options->((idx)::int)) INTO v_shuffled_options 
        FROM jsonb_array_elements_text(v_issued.option_order) AS idx;

      RETURN json_build_object(
        'questionId', v_q.id,
        'text', v_q.text,
        'options', v_shuffled_options
      );
    ELSE
      -- Timed out: mark as wrong and apply lockout
      UPDATE public.issued_questions SET answered_at = now(), was_correct = false WHERE id = v_issued.id;
      UPDATE public.players SET 
        wrong_answers = wrong_answers + 1,
        locked_until = now() + (v_cfg.wrong_lockout_ms * interval '1 millisecond'),
        current_question_id = NULL
      WHERE id = v_player_id;

      RAISE EXCEPTION 'Previous question timed out. Lockout applied.';
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

  -- Build shuffled options array
  SELECT jsonb_agg(v_q.options->((idx)::int)) INTO v_shuffled_options 
    FROM jsonb_array_elements_text(v_order) AS idx;

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

-- E. submit_answer(p_question_id uuid, p_option_index int)
CREATE OR REPLACE FUNCTION public.submit_answer(p_question_id uuid, p_option_index int)
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
  IF now() >= v_cfg.end_at THEN
    RAISE EXCEPTION 'Race has ended';
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

-- F. submit_lap(p_lap_number int, p_lap_time_ms int)
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
  v_prev_time timestamptz;
  v_elapsed_ms numeric;
  v_new_laps int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN
    RETURN json_build_object('accepted', false, 'laps', 0, 'reason', 'Unauthorized');
  END IF;

  SELECT * INTO v_cfg FROM public.game_config LIMIT 1;
  SELECT * INTO v_player FROM public.players WHERE id = v_player_id;
  IF NOT FOUND THEN
    RETURN json_build_object('accepted', false, 'laps', 0, 'reason', 'Player not found');
  END IF;

  -- (e) Race window is open
  IF NOT v_cfg.is_open OR now() < v_cfg.start_at OR now() > v_cfg.end_at THEN
    RETURN json_build_object('accepted', false, 'laps', v_player.laps, 'reason', 'Race window is closed');
  END IF;

  -- (a) p_lap_number = laps + 1
  IF p_lap_number != v_player.laps + 1 THEN
    RETURN json_build_object('accepted', false, 'laps', v_player.laps, 'reason', 'Invalid lap sequence');
  END IF;

  -- (b) p_lap_time_ms >= min_lap_ms
  IF p_lap_time_ms < v_cfg.min_lap_ms THEN
    RETURN json_build_object('accepted', false, 'laps', v_player.laps, 'reason', 'Lap time below minimum threshold');
  END IF;

  -- (c) At least 0.9 * min_lap_ms has passed since last_lap_at (or joined_at)
  v_prev_time := COALESCE(v_player.last_lap_at, v_player.joined_at);
  v_elapsed_ms := EXTRACT(EPOCH FROM (now() - v_prev_time)) * 1000;
  IF v_elapsed_ms < (v_cfg.min_lap_ms * 0.9) THEN
    RETURN json_build_object('accepted', false, 'laps', v_player.laps, 'reason', 'Lap submitted too quickly');
  END IF;

  -- (d) (laps + 1) * min_lap_ms <= fuel_granted_ms * 1.05
  IF (v_player.laps + 1) * v_cfg.min_lap_ms > (v_player.fuel_granted_ms * 1.05) THEN
    RETURN json_build_object('accepted', false, 'laps', v_player.laps, 'reason', 'Laps exceed earned fuel');
  END IF;

  -- On accept
  UPDATE public.players SET 
    laps = laps + 1,
    last_lap_at = now()
  WHERE id = v_player_id
  RETURNING laps INTO v_new_laps;

  RETURN json_build_object('accepted', true, 'laps', v_new_laps);
END;
$$;

-- G. get_leaderboard(p_limit int default 10)
CREATE OR REPLACE FUNCTION public.get_leaderboard(p_limit int DEFAULT 10)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_total int;
  v_top json;
  v_me json;
BEGIN
  v_player_id := auth.uid();
  SELECT COUNT(*)::int INTO v_total FROM public.players;

  WITH ranked AS (
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY laps DESC, correct_answers DESC, last_lap_at ASC NULLS LAST, id ASC
      )::int AS rank,
      id,
      name,
      laps,
      correct_answers AS correct
    FROM public.players
  )
  SELECT
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'rank', rank,
            'name', name,
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
        'laps', laps,
        'correct', correct,
        'isMe', true
      )
      FROM ranked
      WHERE id = v_player_id
      LIMIT 1
    )
  INTO v_top, v_me;

  RETURN json_build_object(
    'top', v_top,
    'me', v_me,
    'totalPlayers', v_total
  );
END;
$$;

-- Grant EXECUTE permission on public RPC functions to anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_config() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_server_time() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_race(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_question() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_answer(uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lap(int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(int) TO anon, authenticated;


-- Crescendo Fuel Rush: Questions Seed Script
-- Populates the questions table from questions.seed.json
-- Can be re-run safely on event day to reset or update questions.

-- Clean or reset questions if desired (optional)
-- DELETE FROM public.issued_questions;
-- DELETE FROM public.questions;

INSERT INTO public.questions (text, options, correct_index, active) VALUES
  ('What does the "typeof null" expression return in JavaScript?', '["\"null\"","\"object\"","\"undefined\"","\"number\""]'::jsonb, NaN, true),
  ('In Python, which keyword is used to define a generator function?', '["yield","generate","return","async"]'::jsonb, NaN, true),
  ('In C, what operator is used to access the memory address of a variable?', '["*","&","->","%"]'::jsonb, NaN, true),
  ('Which symbol represents strict equality comparison in JavaScript?', '["==","===","!=","="]'::jsonb, NaN, true),
  ('In Java, which access modifier allows access only within the same class?', '["protected","public","private","package-private"]'::jsonb, NaN, true),
  ('Which function converts a JSON string into a JavaScript object?', '["JSON.parse()","JSON.stringify()","JSON.toObject()","JSON.encode()"]'::jsonb, NaN, true),
  ('What is the default value of an uninitialized boolean in Java?', '["null","true","false","0"]'::jsonb, NaN, true),
  ('Which keyword creates an immutable variable declaration in modern JavaScript?', '["var","let","const","immutable"]'::jsonb, NaN, true),
  ('In C++, what does RAII stand for?', '["Resource Acquisition Is Initialization","Random Access Iteration Interface","Runtime Allocation In Instruction","Recursive Algorithm Index Instance"]'::jsonb, NaN, true),
  ('In Python, what is the output of bool([])?', '["True","False","None","Error"]'::jsonb, NaN, true),
  ('Which data structure operates on a Last-In, First-Out (LIFO) basis?', '["Queue","Stack","Heap","Graph"]'::jsonb, NaN, true),
  ('What is the average time complexity of Binary Search on a sorted array?', '["O(1)","O(log n)","O(n)","O(n log n)"]'::jsonb, NaN, true),
  ('Which data structure is typically used to implement Breadth-First Search (BFS)?', '["Stack","Queue","Tree","Array"]'::jsonb, NaN, true),
  ('What is the worst-case lookup time complexity in a standard Hash Table?', '["O(1)","O(log n)","O(n)","O(n^2)"]'::jsonb, NaN, true),
  ('Which sorting algorithm has a worst-case time complexity of O(n log n)?', '["QuickSort","MergeSort","BubbleSort","SelectionSort"]'::jsonb, NaN, true),
  ('In a complete binary tree of height h, what is the maximum number of nodes?', '["2^(h+1) - 1","2^h","h^2","2h + 1"]'::jsonb, NaN, true),
  ('Which algorithm finds the shortest path between nodes in a weighted graph without negative weights?', '["Kruskal","Dijkstra","Floyd-Warshall","Prim"]'::jsonb, NaN, true),
  ('What is a self-balancing binary search tree where heights of children differ by at most 1?', '["B-Tree","AVL Tree","Trie","Splay Tree"]'::jsonb, NaN, true),
  ('Which data structure stores key-value pairs and allows efficient prefix lookup?', '["Trie","Stack","Circular Queue","Disjoint Set"]'::jsonb, NaN, true),
  ('What algorithmic paradigm does Merge Sort primarily utilize?', '["Greedy","Dynamic Programming","Divide and Conquer","Backtracking"]'::jsonb, NaN, true),
  ('What is the default port number for standard HTTPS traffic?', '["80","8080","443","22"]'::jsonb, NaN, true),
  ('Which layer of the OSI model handles logical IP addressing and routing?', '["Transport","Network","Data Link","Session"]'::jsonb, NaN, true),
  ('What protocol translates human-readable domain names into numerical IP addresses?', '["DHCP","DNS","ARP","ICMP"]'::jsonb, NaN, true),
  ('How many packets are exchanged in a standard TCP connection handshake?', '["2","3","4","1"]'::jsonb, NaN, true),
  ('What is the size of an IPv4 address in bits?', '["32 bits","64 bits","128 bits","16 bits"]'::jsonb, NaN, true),
  ('What is the size of an IPv6 address in bits?', '["64 bits","128 bits","256 bits","512 bits"]'::jsonb, NaN, true),
  ('Which transport layer protocol is connectionless and does not guarantee packet delivery?', '["TCP","UDP","SCTP","HTTP"]'::jsonb, NaN, true),
  ('What does the HTTP 404 status code indicate?', '["Unauthorized","Forbidden","Not Found","Internal Server Error"]'::jsonb, NaN, true),
  ('What port is commonly used for secure SSH remote connections?', '["21","22","25","23"]'::jsonb, NaN, true),
  ('Which protocol dynamically assigns IP addresses to devices on a local network?', '["DHCP","NAT","BGP","SNMP"]'::jsonb, NaN, true),
  ('What term describes a condition where two processes wait indefinitely for each other to release resources?', '["Starvation","Deadlock","Race Condition","Thrashing"]'::jsonb, NaN, true),
  ('In Linux, what command is used to display current active running processes?', '["ls","ps","cd","cat"]'::jsonb, NaN, true),
  ('What hardware component translates virtual memory addresses into physical RAM addresses?', '["ALU","MMU","Registers","DMA Controller"]'::jsonb, NaN, true),
  ('What is the default Process ID (PID) assigned to the Linux systemd or init process?', '["0","1","-1","100"]'::jsonb, NaN, true),
  ('In Linux, what command changes file permissions?', '["chown","chmod","chroot","passwd"]'::jsonb, NaN, true),
  ('What CPU scheduling algorithm assigns each process a fixed cyclic time slice?', '["First-Come, First-Served","Round Robin","Shortest Job First","Priority Scheduling"]'::jsonb, NaN, true),
  ('What is the core computer program that holds complete control over the entire system called?', '["Shell","Kernel","Compiler","Hypervisor"]'::jsonb, NaN, true),
  ('Which IPC mechanism provides synchronization using two atomic operations, wait and signal?', '["Semaphore","Pipe","Socket","Shared Memory"]'::jsonb, NaN, true),
  ('What Linux signal corresponds to graceful termination (SIGTERM)?', '["Signal 9","Signal 15","Signal 1","Signal 2"]'::jsonb, NaN, true),
  ('What page replacement algorithm suffers from Belady’s Anomaly?', '["FIFO","LRU","Optimal","Clock"]'::jsonb, NaN, true),
  ('What does the "A" in ACID database properties stand for?', '["Availability","Atomicity","Authentication","Auditability"]'::jsonb, NaN, true),
  ('Which SQL clause is used to filter records after aggregate groupings have been applied?', '["WHERE","HAVING","GROUP BY","ORDER BY"]'::jsonb, NaN, true),
  ('What data structure is most commonly used for relational database indexes (B-Tree)?', '["B+ Tree","Heap","Linked List","Binary Tree"]'::jsonb, NaN, true),
  ('Which SQL command removes all rows from a table without logging individual row deletions?', '["DELETE","TRUNCATE","DROP","REMOVE"]'::jsonb, NaN, true),
  ('In relational databases, what key uniquely identifies each record and cannot contain null values?', '["Foreign Key","Primary Key","Candidate Key","Composite Key"]'::jsonb, NaN, true),
  ('Which type of database is Redis classified as?', '["Document Store","Key-Value In-Memory Store","Relational Database","Graph Database"]'::jsonb, NaN, true),
  ('In normalization, what normal form eliminates partial dependencies on candidate keys?', '["1NF","2NF","3NF","BCNF"]'::jsonb, NaN, true),
  ('What SQL keyword removes duplicate rows from the final result set?', '["UNIQUE","DISTINCT","FILTER","CLEAN"]'::jsonb, NaN, true),
  ('Which database isolation level prevents dirty reads, non-repeatable reads, and phantom reads?', '["Read Uncommitted","Read Committed","Repeatable Read","Serializable"]'::jsonb, NaN, true),
  ('Which open-source relational database is known for advanced extensibility and PostgreSQL syntax?', '["PostgreSQL","SQLite","MongoDB","CouchDB"]'::jsonb, NaN, true),
  ('What does CSS stand for?', '["Cascading Style Sheets","Computer Styling System","Creative Screen Styles","Control Sheet Standard"]'::jsonb, NaN, true),
  ('Which HTTP header is used for security protection against Cross-Site Scripting (XSS)?', '["Content-Security-Policy","Access-Control-Allow-Origin","Strict-Transport-Security","X-Frame-Options"]'::jsonb, NaN, true),
  ('Who is widely recognized as the world’s first computer programmer?', '["Alan Turing","Ada Lovelace","Grace Hopper","Charles Babbage"]'::jsonb, NaN, true),
  ('In what year was the World Wide Web publicly introduced by Tim Berners-Lee?', '["1983","1989","1991","1995"]'::jsonb, NaN, true),
  ('Who created the Linux operating system kernel in 1991?', '["Richard Stallman","Linus Torvalds","Ken Thompson","Dennis Ritchie"]'::jsonb, NaN, true),
  ('Which HTML5 element is used for procedural script-based graphics rendering?', '["<canvas>","<svg>","<graphic>","<paint>"]'::jsonb, NaN, true),
  ('In WebSockets, which protocol scheme is used for secure encrypted socket communication?', '["ws://","wss://","https://","socket://"]'::jsonb, NaN, true),
  ('What was the name of the first electronic general-purpose digital computer completed in 1945?', '["UNIVAC","ENIAC","Colossus","EDVAC"]'::jsonb, NaN, true),
  ('What does DOM stand for in modern web development?', '["Document Object Model","Data Oriented Module","Dynamic Output Management","Desktop Operation Mode"]'::jsonb, NaN, true),
  ('Who co-founded Apple Computer alongside Steve Jobs in 1976?', '["Steve Wozniak","Bill Gates","Paul Allen","Gordon Moore"]'::jsonb, NaN, true);
