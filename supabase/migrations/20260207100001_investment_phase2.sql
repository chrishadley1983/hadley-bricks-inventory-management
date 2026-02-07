-- Investment Predictor - Phase 2: Amazon Integration + Classification
-- Migration: 20260207100001_investment_phase2
-- Purpose: Add classification_override JSONB column for manual overrides

-- Classification override support
ALTER TABLE brickset_sets ADD COLUMN IF NOT EXISTS classification_override JSONB;

COMMENT ON COLUMN brickset_sets.classification_override IS 'Manual override for auto-classification fields (is_licensed, is_ucs, is_modular, exclusivity_tier). Takes precedence over auto-detected values.';
