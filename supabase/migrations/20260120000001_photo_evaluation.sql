-- ============================================================================
-- PHOTO EVALUATION SCHEMA ADDITIONS
-- Extends purchase evaluator for photo-based lot evaluation
-- ============================================================================

-- ============================================================================
-- UPDATE PURCHASE_EVALUATIONS TABLE
-- Add columns for photo evaluation mode
-- ============================================================================

-- Add evaluation mode column
ALTER TABLE purchase_evaluations
  ADD COLUMN IF NOT EXISTS evaluation_mode VARCHAR(20) DEFAULT 'cost_known'
    CHECK (evaluation_mode IN ('cost_known', 'max_bid'));

COMMENT ON COLUMN purchase_evaluations.evaluation_mode IS 'cost_known = traditional mode (known cost, calculate profit), max_bid = photo mode (calculate max purchase price from target margin)';

-- Add target margin for max_bid mode
ALTER TABLE purchase_evaluations
  ADD COLUMN IF NOT EXISTS target_margin_percent DECIMAL(5,2);

COMMENT ON COLUMN purchase_evaluations.target_margin_percent IS 'Target profit margin percentage (20-50%) for max_bid mode calculations';

-- Add photo analysis JSON storage
ALTER TABLE purchase_evaluations
  ADD COLUMN IF NOT EXISTS photo_analysis_json JSONB;

COMMENT ON COLUMN purchase_evaluations.photo_analysis_json IS 'Raw photo analysis results from AI models (Claude Opus, Gemini, Brickognize)';

-- Add listing description (for context from auction listings)
ALTER TABLE purchase_evaluations
  ADD COLUMN IF NOT EXISTS listing_description TEXT;

COMMENT ON COLUMN purchase_evaluations.listing_description IS 'Optional seller listing description to assist AI identification';

-- Update source check constraint to include photo_analysis
ALTER TABLE purchase_evaluations
  DROP CONSTRAINT IF EXISTS purchase_evaluations_source_check;

-- Note: source column doesn't have a check constraint in original migration,
-- so we just need to update the comment
COMMENT ON COLUMN purchase_evaluations.source IS 'How the data was imported: csv_upload, clipboard_paste, or photo_analysis';

-- Update status check constraint to include 'converted'
ALTER TABLE purchase_evaluations
  DROP CONSTRAINT IF EXISTS purchase_evaluations_status_check;

ALTER TABLE purchase_evaluations
  ADD CONSTRAINT purchase_evaluations_status_check
    CHECK (status IN ('draft', 'in_progress', 'completed', 'saved', 'converted'));

-- ============================================================================
-- UPDATE PURCHASE_EVALUATION_ITEMS TABLE
-- Add columns for photo-identified items
-- ============================================================================

-- Add item type for photo-identified items
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) DEFAULT 'set'
    CHECK (item_type IN ('set', 'minifig', 'parts_lot', 'non_lego', 'unknown'));

COMMENT ON COLUMN purchase_evaluation_items.item_type IS 'Type of item: set, minifig, parts_lot, non_lego, or unknown';

-- Add box condition for sets
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS box_condition VARCHAR(20)
    CHECK (box_condition IN ('Mint', 'Excellent', 'Good', 'Fair', 'Poor'));

COMMENT ON COLUMN purchase_evaluation_items.box_condition IS 'Box condition rating for sealed/boxed items';

-- Add seal status
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS seal_status VARCHAR(20) DEFAULT 'Unknown'
    CHECK (seal_status IN ('Factory Sealed', 'Resealed', 'Open Box', 'Unknown'));

COMMENT ON COLUMN purchase_evaluation_items.seal_status IS 'Seal status for boxed items';

-- Add damage notes array
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS damage_notes TEXT[];

COMMENT ON COLUMN purchase_evaluation_items.damage_notes IS 'Array of damage/condition notes from AI analysis';

-- Add AI confidence score
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS ai_confidence_score DECIMAL(3,2);

COMMENT ON COLUMN purchase_evaluation_items.ai_confidence_score IS 'Combined confidence score (0.0-1.0) from multi-model AI analysis';

-- Add AI model results JSON
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS ai_model_results JSONB;

COMMENT ON COLUMN purchase_evaluation_items.ai_model_results IS 'Individual model results: [{model: "opus"|"gemini"|"brickognize", setNumber, confidence, rawResponse}]';

-- Add raw AI description
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS ai_raw_description TEXT;

COMMENT ON COLUMN purchase_evaluation_items.ai_raw_description IS 'Raw description of item from primary AI analysis';

-- Add max purchase price (for max_bid mode)
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS max_purchase_price DECIMAL(10,2);

COMMENT ON COLUMN purchase_evaluation_items.max_purchase_price IS 'Calculated maximum purchase price for target margin';

-- Add minifig ID for minifig items (BrickLink ID)
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS minifig_id VARCHAR(50);

COMMENT ON COLUMN purchase_evaluation_items.minifig_id IS 'BrickLink minifigure ID for minifig items';

-- Add part IDs array for parts lots
ALTER TABLE purchase_evaluation_items
  ADD COLUMN IF NOT EXISTS part_ids TEXT[];

COMMENT ON COLUMN purchase_evaluation_items.part_ids IS 'Array of BrickLink part IDs for parts_lot items';

-- ============================================================================
-- INDEXES FOR PHOTO EVALUATION
-- ============================================================================

-- Index for evaluation mode filtering
CREATE INDEX IF NOT EXISTS idx_purchase_evaluations_mode
  ON purchase_evaluations(user_id, evaluation_mode);

-- Index for item type filtering
CREATE INDEX IF NOT EXISTS idx_purchase_evaluation_items_type
  ON purchase_evaluation_items(evaluation_id, item_type);

-- Index for items needing review with low confidence
CREATE INDEX IF NOT EXISTS idx_purchase_evaluation_items_low_confidence
  ON purchase_evaluation_items(evaluation_id, ai_confidence_score)
  WHERE ai_confidence_score < 0.5;
