-- Migration: MTD Export History Table
-- Purpose: Track MTD export history for QuickFile integration

CREATE TABLE mtd_export_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- Format: YYYY-MM
  export_type TEXT NOT NULL CHECK (export_type IN ('csv', 'quickfile')),
  entries_count INTEGER NOT NULL DEFAULT 0,
  quickfile_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX idx_mtd_export_history_user ON mtd_export_history(user_id);
CREATE INDEX idx_mtd_export_history_month ON mtd_export_history(user_id, month);
CREATE INDEX idx_mtd_export_history_type ON mtd_export_history(user_id, export_type);

-- RLS Policies
ALTER TABLE mtd_export_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mtd_export_history"
  ON mtd_export_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mtd_export_history"
  ON mtd_export_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);
