ALTER TABLE practice.attempts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'digital'
  CHECK (source IN ('digital', 'paper'));;
