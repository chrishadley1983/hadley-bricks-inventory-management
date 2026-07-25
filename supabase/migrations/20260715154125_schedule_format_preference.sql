ALTER TABLE practice.schedules ADD COLUMN IF NOT EXISTS format_preference TEXT
  CHECK (format_preference IN ('mc', 'text'));;
