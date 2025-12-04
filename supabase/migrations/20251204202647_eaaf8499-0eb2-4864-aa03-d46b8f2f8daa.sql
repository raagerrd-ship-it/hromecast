-- Remove unused check_count column
ALTER TABLE public.screensaver_settings DROP COLUMN IF EXISTS check_count;