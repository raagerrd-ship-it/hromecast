-- Add unique constraint to prevent duplicate chromecasts per bridge device
ALTER TABLE public.discovered_chromecasts
ADD CONSTRAINT discovered_chromecasts_device_host_unique 
UNIQUE (device_id, chromecast_host);