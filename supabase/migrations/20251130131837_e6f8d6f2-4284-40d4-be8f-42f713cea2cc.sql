-- Create table for cast commands queue
CREATE TABLE public.cast_commands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE
);

-- Enable Row Level Security
ALTER TABLE public.cast_commands ENABLE ROW LEVEL SECURITY;

-- Allow public access for this simple app
CREATE POLICY "Anyone can view cast commands"
  ON public.cast_commands
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert cast commands"
  ON public.cast_commands
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update cast commands"
  ON public.cast_commands
  FOR UPDATE
  USING (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.cast_commands;

-- Create index for faster queries
CREATE INDEX idx_cast_commands_device_status ON public.cast_commands(device_id, status, created_at);