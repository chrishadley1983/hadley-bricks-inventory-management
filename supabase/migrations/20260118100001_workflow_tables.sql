-- Workflow Tables
-- Migration: 20260118100001_workflow_tables
-- Purpose: Create tables for the business workflow feature (task queue, off-system tasks)

-- ============================================================================
-- WORKFLOW CONFIG TABLE
-- User-level settings for workflow targets and preferences
-- ============================================================================
CREATE TABLE workflow_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Listing inventory targets (Phase 4)
  target_ebay_listings INTEGER DEFAULT 500,
  target_amazon_listings INTEGER DEFAULT 250,
  target_bricklink_weekly_value DECIMAL DEFAULT 1000,

  -- Daily flow targets (Phase 4)
  target_daily_listed_value DECIMAL DEFAULT 300,
  target_daily_sold_value DECIMAL DEFAULT 250,

  -- Working days (bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64)
  working_days INTEGER DEFAULT 127, -- All days

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- WORKFLOW TASK DEFINITIONS TABLE
-- Defines recurring tasks (system and custom)
-- ============================================================================
CREATE TABLE workflow_task_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL, -- Development, Listing, Shipping, Sourcing, Admin, Other
  icon VARCHAR(10),

  -- Scheduling
  frequency VARCHAR(50) NOT NULL, -- daily, twice_daily, twice_weekly, weekly, monthly, quarterly, biannual, adhoc
  frequency_days INTEGER[], -- For twice_weekly: [1,4] = Mon/Thu (1=Mon, 7=Sun)
  ideal_time VARCHAR(10), -- 'AM', 'PM', 'ANY'

  -- Priority & effort
  priority INTEGER DEFAULT 3, -- 1=Critical, 2=Important, 3=Regular, 4=Low
  estimated_minutes INTEGER,

  -- Deep link
  deep_link_url VARCHAR(255),
  deep_link_params JSONB,

  -- Dynamic count source (e.g., 'orders.paid', 'inventory.backlog')
  count_source VARCHAR(100),

  -- Task type
  task_type VARCHAR(20) DEFAULT 'system', -- system, off_system

  -- State
  is_active BOOLEAN DEFAULT TRUE,
  is_system BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- WORKFLOW TASK INSTANCES TABLE
-- Individual task instances for a specific date
-- ============================================================================
CREATE TABLE workflow_task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_definition_id UUID REFERENCES workflow_task_definitions(id) ON DELETE SET NULL,

  -- For ad-hoc tasks without definition
  name VARCHAR(255),
  description TEXT,
  category VARCHAR(50),
  icon VARCHAR(10),
  priority INTEGER,
  estimated_minutes INTEGER,
  deep_link_url VARCHAR(255),

  -- Task type
  task_type VARCHAR(20) DEFAULT 'system', -- system, off_system

  -- Scheduling
  scheduled_date DATE NOT NULL,
  due_time TIME,

  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, skipped, deferred

  -- Completion tracking
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,

  -- For deferred tasks
  deferred_from_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- OFF-SYSTEM TASK PRESETS TABLE
-- Quick-add presets for off-system tasks (manual activities)
-- ============================================================================
CREATE TABLE off_system_task_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  icon VARCHAR(10),
  category VARCHAR(50) NOT NULL,
  default_duration_minutes INTEGER,
  default_priority INTEGER DEFAULT 3,

  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Workflow config
CREATE INDEX idx_workflow_config_user ON workflow_config(user_id);

-- Task definitions
CREATE INDEX idx_workflow_task_definitions_user ON workflow_task_definitions(user_id);
CREATE INDEX idx_workflow_task_definitions_active ON workflow_task_definitions(user_id, is_active)
  WHERE is_active = TRUE;

-- Task instances
CREATE INDEX idx_workflow_task_instances_user_date ON workflow_task_instances(user_id, scheduled_date);
CREATE INDEX idx_workflow_task_instances_status ON workflow_task_instances(status);
CREATE INDEX idx_workflow_task_instances_today_pending ON workflow_task_instances(user_id, scheduled_date, status)
  WHERE status IN ('pending', 'in_progress');

-- Off-system presets
CREATE INDEX idx_off_system_task_presets_user ON off_system_task_presets(user_id);
CREATE INDEX idx_off_system_task_presets_active ON off_system_task_presets(user_id, is_active)
  WHERE is_active = TRUE;

-- ============================================================================
-- RLS POLICIES FOR WORKFLOW_CONFIG
-- ============================================================================
ALTER TABLE workflow_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workflow config"
  ON workflow_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workflow config"
  ON workflow_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workflow config"
  ON workflow_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workflow config"
  ON workflow_config FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES FOR WORKFLOW_TASK_DEFINITIONS
-- ============================================================================
ALTER TABLE workflow_task_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task definitions"
  ON workflow_task_definitions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own task definitions"
  ON workflow_task_definitions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own task definitions"
  ON workflow_task_definitions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own task definitions"
  ON workflow_task_definitions FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES FOR WORKFLOW_TASK_INSTANCES
-- ============================================================================
ALTER TABLE workflow_task_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task instances"
  ON workflow_task_instances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own task instances"
  ON workflow_task_instances FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own task instances"
  ON workflow_task_instances FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own task instances"
  ON workflow_task_instances FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES FOR OFF_SYSTEM_TASK_PRESETS
-- ============================================================================
ALTER TABLE off_system_task_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own off-system presets"
  ON off_system_task_presets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own off-system presets"
  ON off_system_task_presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own off-system presets"
  ON off_system_task_presets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own off-system presets"
  ON off_system_task_presets FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Auto-update updated_at for workflow tables
CREATE TRIGGER update_workflow_config_updated_at
  BEFORE UPDATE ON workflow_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_task_definitions_updated_at
  BEFORE UPDATE ON workflow_task_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_task_instances_updated_at
  BEFORE UPDATE ON workflow_task_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
