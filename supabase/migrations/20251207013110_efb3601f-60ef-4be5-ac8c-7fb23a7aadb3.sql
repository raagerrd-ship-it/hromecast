-- Enable full replica identity for realtime updates
ALTER TABLE public.cast_commands REPLICA IDENTITY FULL;