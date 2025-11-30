-- Create table for discovered Chromecast devices
CREATE TABLE public.discovered_chromecasts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id text NOT NULL,
  chromecast_name text NOT NULL,
  chromecast_host text NOT NULL,
  chromecast_port integer NOT NULL DEFAULT 8009,
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.discovered_chromecasts ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view discovered chromecasts"
ON public.discovered_chromecasts
FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert discovered chromecasts"
ON public.discovered_chromecasts
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update discovered chromecasts"
ON public.discovered_chromecasts
FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete discovered chromecasts"
ON public.discovered_chromecasts
FOR DELETE
USING (true);

-- Add selected_chromecast_id to screensaver_settings
ALTER TABLE public.screensaver_settings
ADD COLUMN selected_chromecast_id uuid REFERENCES public.discovered_chromecasts(id);

-- Enable realtime for the table
ALTER PUBLICATION supabase_realtime ADD TABLE public.discovered_chromecasts;