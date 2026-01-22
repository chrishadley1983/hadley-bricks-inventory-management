-- Add end_time column to stock_pickups
-- This allows specifying a time range for pickups instead of just a start time

ALTER TABLE stock_pickups
ADD COLUMN scheduled_end_time TIME;

-- Add a comment explaining the columns
COMMENT ON COLUMN stock_pickups.scheduled_time IS 'Start time of the pickup (HH:MM format)';
COMMENT ON COLUMN stock_pickups.scheduled_end_time IS 'End time of the pickup (HH:MM format)';
