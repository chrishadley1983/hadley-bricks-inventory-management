ALTER TABLE practice.schedules ADD COLUMN IF NOT EXISTS week_parity SMALLINT
  CHECK (week_parity IN (0, 1));
ALTER TABLE practice.schedules DROP CONSTRAINT IF EXISTS schedules_student_day_slot_unique;
CREATE UNIQUE INDEX IF NOT EXISTS schedules_student_day_slot_parity_unique
  ON practice.schedules (student_id, day_of_week, slot_order, COALESCE(week_parity, -1));;
