-- ============================================================================
-- PURCHASE EVALUATOR TABLES
-- Tables for evaluating potential LEGO purchases
-- ============================================================================

-- ============================================================================
-- PURCHASE EVALUATIONS TABLE
-- Main record for each evaluation session
-- ============================================================================
CREATE TABLE purchase_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Evaluation metadata
  name VARCHAR(255),
  source VARCHAR(100),                    -- 'csv_upload', 'clipboard_paste'
  default_platform VARCHAR(20) DEFAULT 'amazon' CHECK (default_platform IN ('amazon', 'ebay')),

  -- Cost allocation
  total_purchase_price DECIMAL(10,2),     -- If user provides total cost
  cost_allocation_method VARCHAR(20) CHECK (cost_allocation_method IN ('per_item', 'proportional', 'equal')),

  -- Summary stats (denormalized for quick display)
  item_count INTEGER DEFAULT 0,
  total_cost DECIMAL(10,2),
  total_expected_revenue DECIMAL(10,2),
  overall_margin_percent DECIMAL(5,2),
  overall_roi_percent DECIMAL(7,2),

  -- Status tracking
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'saved')),
  lookup_completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE purchase_evaluations IS 'Purchase evaluation sessions for analyzing potential buys';
COMMENT ON COLUMN purchase_evaluations.source IS 'How the data was imported: csv_upload or clipboard_paste';
COMMENT ON COLUMN purchase_evaluations.cost_allocation_method IS 'per_item = costs provided individually, proportional = allocated by RRP ratio, equal = split evenly';
COMMENT ON COLUMN purchase_evaluations.status IS 'draft = being edited, in_progress = lookups running, completed = ready to review, saved = finalized';

-- ============================================================================
-- PURCHASE EVALUATION ITEMS TABLE
-- Individual items within an evaluation
-- ============================================================================
CREATE TABLE purchase_evaluation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID NOT NULL REFERENCES purchase_evaluations(id) ON DELETE CASCADE,

  -- Item identification
  set_number VARCHAR(50) NOT NULL,
  set_name VARCHAR(500),
  condition VARCHAR(10) NOT NULL CHECK (condition IN ('New', 'Used')),
  quantity INTEGER DEFAULT 1,

  -- Cost data
  unit_cost DECIMAL(10,2),                -- Cost per item (user provided)
  allocated_cost DECIMAL(10,2),           -- Calculated cost after allocation

  -- Brickset reference
  brickset_set_id UUID REFERENCES brickset_sets(id),
  uk_retail_price DECIMAL(10,2),          -- RRP for cost allocation calculations
  ean VARCHAR(20),
  upc VARCHAR(20),
  image_url VARCHAR(1000),

  -- Target platform
  target_platform VARCHAR(20) DEFAULT 'amazon' CHECK (target_platform IN ('amazon', 'ebay')),

  -- Amazon pricing data
  amazon_asin VARCHAR(20),
  amazon_asin_source VARCHAR(20) CHECK (amazon_asin_source IN ('ean_lookup', 'upc_lookup', 'keyword_search', 'manual')),
  amazon_asin_confidence VARCHAR(20) CHECK (amazon_asin_confidence IN ('exact', 'probable', 'manual', 'multiple')),
  amazon_alternative_asins JSONB,         -- For multiple match scenarios [{asin, title, confidence}]
  amazon_buy_box_price DECIMAL(10,2),
  amazon_my_price DECIMAL(10,2),
  amazon_was_price DECIMAL(10,2),         -- 90-day median
  amazon_offer_count INTEGER,
  amazon_sales_rank INTEGER,
  amazon_lookup_status VARCHAR(20) DEFAULT 'pending' CHECK (amazon_lookup_status IN ('pending', 'found', 'not_found', 'multiple', 'error')),
  amazon_lookup_error TEXT,

  -- eBay pricing data (active listings from Browse API)
  ebay_min_price DECIMAL(10,2),
  ebay_avg_price DECIMAL(10,2),
  ebay_max_price DECIMAL(10,2),
  ebay_listing_count INTEGER,
  ebay_listings_json JSONB,               -- Sample of active listings

  -- eBay sold data (completed listings from Finding API)
  ebay_sold_min_price DECIMAL(10,2),
  ebay_sold_avg_price DECIMAL(10,2),
  ebay_sold_max_price DECIMAL(10,2),
  ebay_sold_count INTEGER,
  ebay_sold_listings_json JSONB,          -- Sample of sold listings
  ebay_lookup_status VARCHAR(20) DEFAULT 'pending' CHECK (ebay_lookup_status IN ('pending', 'found', 'not_found', 'error')),
  ebay_lookup_error TEXT,

  -- Calculated profitability (for selected platform)
  expected_sell_price DECIMAL(10,2),      -- Selected price for calculations
  cog_percent DECIMAL(5,2),               -- Cost of goods % = (cost / sell price) * 100
  gross_profit DECIMAL(10,2),
  profit_margin_percent DECIMAL(5,2),
  roi_percent DECIMAL(7,2),

  -- User overrides
  user_sell_price_override DECIMAL(10,2), -- User can override expected price
  user_notes TEXT,

  -- Status
  needs_review BOOLEAN DEFAULT FALSE,     -- Flag for multiple ASINs or issues

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE purchase_evaluation_items IS 'Individual items within a purchase evaluation';
COMMENT ON COLUMN purchase_evaluation_items.amazon_asin_source IS 'How the ASIN was found: ean_lookup, upc_lookup, keyword_search, or manual';
COMMENT ON COLUMN purchase_evaluation_items.amazon_asin_confidence IS 'How confident we are in the ASIN match';
COMMENT ON COLUMN purchase_evaluation_items.needs_review IS 'True if item needs user attention (multiple ASINs, errors, etc.)';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Purchase evaluations indexes
CREATE INDEX idx_purchase_evaluations_user ON purchase_evaluations(user_id);
CREATE INDEX idx_purchase_evaluations_status ON purchase_evaluations(user_id, status);
CREATE INDEX idx_purchase_evaluations_created ON purchase_evaluations(user_id, created_at DESC);

-- Purchase evaluation items indexes
CREATE INDEX idx_purchase_evaluation_items_evaluation ON purchase_evaluation_items(evaluation_id);
CREATE INDEX idx_purchase_evaluation_items_set ON purchase_evaluation_items(set_number);
CREATE INDEX idx_purchase_evaluation_items_needs_review ON purchase_evaluation_items(evaluation_id, needs_review) WHERE needs_review = TRUE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE purchase_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_evaluation_items ENABLE ROW LEVEL SECURITY;

-- Evaluations policies
CREATE POLICY "Users can view own evaluations"
  ON purchase_evaluations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own evaluations"
  ON purchase_evaluations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own evaluations"
  ON purchase_evaluations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own evaluations"
  ON purchase_evaluations FOR DELETE
  USING (auth.uid() = user_id);

-- Items policies (based on parent evaluation ownership)
CREATE POLICY "Users can view own evaluation items"
  ON purchase_evaluation_items FOR SELECT
  USING (evaluation_id IN (SELECT id FROM purchase_evaluations WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own evaluation items"
  ON purchase_evaluation_items FOR INSERT
  WITH CHECK (evaluation_id IN (SELECT id FROM purchase_evaluations WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own evaluation items"
  ON purchase_evaluation_items FOR UPDATE
  USING (evaluation_id IN (SELECT id FROM purchase_evaluations WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own evaluation items"
  ON purchase_evaluation_items FOR DELETE
  USING (evaluation_id IN (SELECT id FROM purchase_evaluations WHERE user_id = auth.uid()));

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_purchase_evaluations_updated_at
  BEFORE UPDATE ON purchase_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_evaluation_items_updated_at
  BEFORE UPDATE ON purchase_evaluation_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
