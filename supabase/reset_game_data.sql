-- ============================================================================
-- Crescendo Fuel Rush: Complete Test Data Reset Script
-- ============================================================================
-- Run this in your Supabase SQL Editor before the event goes live.
-- This wipes all test racers, test laps, test questions issued, and resets
-- the leaderboard to a clean slate, while keeping your question bank intact.
-- ============================================================================

-- 1. Truncate issued question history
TRUNCATE TABLE public.issued_questions CASCADE;

-- 2. Truncate laps table if present
DO $$ 
BEGIN 
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'laps') THEN 
    EXECUTE 'TRUNCATE TABLE public.laps CASCADE'; 
  END IF; 
END $$;

-- 3. Delete all test players (resets leaderboard & scores to 0)
DELETE FROM public.players;

-- 4. (Optional) Remove anonymous test user accounts from Supabase Auth
-- Uncomment the line below if you also want to remove test auth records:
-- DELETE FROM auth.users WHERE is_anonymous = true;

-- 5. Verification: Check clean slate
SELECT 
  (SELECT count(*) FROM public.players) AS total_players,
  (SELECT count(*) FROM public.issued_questions) AS total_issued_questions,
  (SELECT count(*) FROM public.questions WHERE active = true) AS active_question_bank;
