-- Create table for screensaver settings
CREATE TABLE public.screensaver_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  url TEXT,
  idle_timeout INTEGER NOT NULL DEFAULT 5,
  check_interval INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.screensaver_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read and write their own device settings (public access for this simple app)
CREATE POLICY "Anyone can view screensaver settings"
  ON public.screensaver_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert screensaver settings"
  ON public.screensaver_settings
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update screensaver settings"
  ON public.screensaver_settings
  FOR UPDATE
  USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_screensaver_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_screensaver_settings_updated_at
  BEFORE UPDATE ON public.screensaver_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_screensaver_settings_updated_at();