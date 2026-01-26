-- Create bridge-files bucket for storing bridge source code
INSERT INTO storage.buckets (id, name, public)
VALUES ('bridge-files', 'bridge-files', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for bridge files
CREATE POLICY "Public read access for bridge files"
ON storage.objects FOR SELECT
USING (bucket_id = 'bridge-files');

-- Admin write access (for uploading new versions)
CREATE POLICY "Admin can upload bridge files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'bridge-files');

CREATE POLICY "Admin can update bridge files"
ON storage.objects FOR UPDATE
USING (bucket_id = 'bridge-files');

CREATE POLICY "Admin can delete bridge files"
ON storage.objects FOR DELETE
USING (bucket_id = 'bridge-files');