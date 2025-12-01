-- Add screensaver_active status and last_check timestamp to screensaver_settings
ALTER TABLE screensaver_settings 
ADD COLUMN screensaver_active BOOLEAN DEFAULT FALSE,
ADD COLUMN last_idle_check TIMESTAMP WITH TIME ZONE DEFAULT NOW();