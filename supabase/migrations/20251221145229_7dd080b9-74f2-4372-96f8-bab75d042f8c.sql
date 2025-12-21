-- Add DELETE policy for cast_commands so bridge can clean up old logs
CREATE POLICY "Anyone can delete cast commands" 
ON public.cast_commands 
FOR DELETE 
USING (true);