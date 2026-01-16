-- Purchase Images Table
-- Stores multiple photos/receipts per purchase for tracking and tax purposes
-- Migration: 20260116100001_purchase_images

-- ============================================================================
-- PURCHASE IMAGES TABLE
-- ============================================================================
CREATE TABLE purchase_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_purchase_images_purchase ON purchase_images(purchase_id);
CREATE INDEX idx_purchase_images_user ON purchase_images(user_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE purchase_images ENABLE ROW LEVEL SECURITY;

-- Users can only see their own purchase images
CREATE POLICY "Users can view own purchase images"
  ON purchase_images FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own purchase images
CREATE POLICY "Users can insert own purchase images"
  ON purchase_images FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own purchase images
CREATE POLICY "Users can update own purchase images"
  ON purchase_images FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own purchase images
CREATE POLICY "Users can delete own purchase images"
  ON purchase_images FOR DELETE
  USING (auth.uid() = user_id);
