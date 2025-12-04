-- Add check count column to track number of idle checks
ALTER TABLE public.screensaver_settings 
ADD COLUMN check_count integer NOT NULL DEFAULT 0;