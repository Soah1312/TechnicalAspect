-- Crescendo Fuel Rush: Set Active Race Window
-- Run this in Supabase SQL Editor to open the race window for live play or load testing

UPDATE public.game_config
SET
  is_open = true,
  start_at = now() - interval '1 minute',
  end_at = now() + interval '120 minutes';

-- Verify current configuration
SELECT
  is_open,
  start_at,
  end_at,
  now() as current_server_time,
  (now() >= start_at AND now() < end_at) as is_active
FROM public.game_config;
