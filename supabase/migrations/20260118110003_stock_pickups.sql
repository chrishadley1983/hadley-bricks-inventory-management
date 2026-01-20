-- Migration: Stock Pickups Table (Phase 5)
-- Creates stock_pickups table for pickup scheduling and tracking

-- ============================================================================
-- stock_pickups: Stock pickup scheduling and completion records
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Basic info
  title VARCHAR(255) NOT NULL,
  description TEXT,
  source_platform VARCHAR(50) CHECK (source_platform IN ('FB Marketplace', 'Gumtree', 'eBay', 'Car Boot', 'Auction', 'Private', 'Other')),

  -- Address
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  postcode VARCHAR(20) NOT NULL,

  -- Scheduling
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  estimated_duration_minutes INTEGER,

  -- Financial
  agreed_price DECIMAL(10,2),
  estimated_value DECIMAL(10,2),

  -- Status
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'completed', 'cancelled', 'no_show')),

  -- Completion details
  outcome VARCHAR(20) CHECK (outcome IN ('completed', 'partial', 'cancelled', 'no_show')),
  final_amount_paid DECIMAL(10,2),
  mileage DECIMAL(10,2),
  mileage_cost DECIMAL(10,2), -- Calculated at 45p/mile
  completion_notes TEXT,
  completed_at TIMESTAMPTZ,

  -- Linking to other entities
  purchase_id UUID, -- Will link to purchases table when purchase is created
  task_instance_id UUID REFERENCES workflow_task_instances(id) ON DELETE SET NULL,

  -- Recurring
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_pattern VARCHAR(20) CHECK (recurrence_pattern IN ('weekly', 'biweekly', 'monthly')),
  parent_pickup_id UUID REFERENCES stock_pickups(id) ON DELETE SET NULL,

  -- Reminder
  reminder_day_before BOOLEAN DEFAULT FALSE,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching pickups by user and date
CREATE INDEX idx_stock_pickups_user_date ON stock_pickups(user_id, scheduled_date);

-- Index for fetching pickups by status
CREATE INDEX idx_stock_pickups_status ON stock_pickups(user_id, status);

-- Index for calendar queries (upcoming pickups)
CREATE INDEX idx_stock_pickups_upcoming ON stock_pickups(user_id, scheduled_date)
  WHERE status IN ('draft', 'scheduled');

-- RLS Policies
ALTER TABLE stock_pickups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pickups"
  ON stock_pickups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pickups"
  ON stock_pickups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pickups"
  ON stock_pickups FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pickups"
  ON stock_pickups FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Function to create recurring pickup instances
-- ============================================================================
CREATE OR REPLACE FUNCTION create_recurring_pickups(
  p_pickup_id UUID,
  p_count INTEGER DEFAULT 4
)
RETURNS VOID AS $$
DECLARE
  parent_pickup stock_pickups%ROWTYPE;
  interval_days INTEGER;
  i INTEGER;
  new_date DATE;
BEGIN
  -- Get parent pickup
  SELECT * INTO parent_pickup FROM stock_pickups WHERE id = p_pickup_id;

  IF parent_pickup.recurrence_pattern IS NULL THEN
    RETURN;
  END IF;

  -- Calculate interval
  CASE parent_pickup.recurrence_pattern
    WHEN 'weekly' THEN interval_days := 7;
    WHEN 'biweekly' THEN interval_days := 14;
    WHEN 'monthly' THEN interval_days := 30;
    ELSE interval_days := 7;
  END CASE;

  -- Create recurring instances
  FOR i IN 1..p_count LOOP
    new_date := parent_pickup.scheduled_date + (i * interval_days);

    INSERT INTO stock_pickups (
      user_id, title, description, source_platform,
      address_line1, address_line2, city, postcode,
      scheduled_date, scheduled_time, estimated_duration_minutes,
      agreed_price, estimated_value, status,
      is_recurring, recurrence_pattern, parent_pickup_id,
      reminder_day_before, notes
    ) VALUES (
      parent_pickup.user_id, parent_pickup.title, parent_pickup.description, parent_pickup.source_platform,
      parent_pickup.address_line1, parent_pickup.address_line2, parent_pickup.city, parent_pickup.postcode,
      new_date, parent_pickup.scheduled_time, parent_pickup.estimated_duration_minutes,
      parent_pickup.agreed_price, parent_pickup.estimated_value, 'scheduled',
      TRUE, parent_pickup.recurrence_pattern, p_pickup_id,
      parent_pickup.reminder_day_before, parent_pickup.notes
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function to calculate mileage cost
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_mileage_cost()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.mileage IS NOT NULL THEN
    -- 45p per mile
    NEW.mileage_cost := ROUND(NEW.mileage * 0.45, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate mileage cost
CREATE TRIGGER trigger_calculate_mileage_cost
  BEFORE INSERT OR UPDATE OF mileage ON stock_pickups
  FOR EACH ROW
  EXECUTE FUNCTION calculate_mileage_cost();
