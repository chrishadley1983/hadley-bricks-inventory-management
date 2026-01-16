-- Purchase Images Storage Bucket
-- Creates the storage bucket and policies for purchase images
-- Migration: 20260116100002_purchase_images_storage

-- ============================================================================
-- CREATE STORAGE BUCKET
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images',
  'images',
  true,  -- Public bucket so images can be viewed without auth
  10485760, -- 10MB file size limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload to own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'images' AND
    (storage.foldername(name))[1] = 'purchases' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Allow authenticated users to update their own files
CREATE POLICY "Users can update own files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'images' AND
    (storage.foldername(name))[1] = 'purchases' AND
    (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'images' AND
    (storage.foldername(name))[1] = 'purchases' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Allow authenticated users to delete their own files
CREATE POLICY "Users can delete own files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'images' AND
    (storage.foldername(name))[1] = 'purchases' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Allow public read access (bucket is public)
CREATE POLICY "Public read access for images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'images');
