-- Migration: Negotiation Engine
-- Creates tables for eBay Negotiation API automation: config, discount rules, and offer audit log

-- ============================================================================
-- 1. negotiation_config - User settings for negotiation automation
-- ============================================================================

CREATE TABLE IF NOT EXISTS negotiation_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  automation_enabled BOOLEAN NOT NULL DEFAULT false,
  min_days_before_offer INTEGER NOT NULL DEFAULT 14,
  re_offer_cooldown_days INTEGER NOT NULL DEFAULT 7,
  re_offer_escalation_percent INTEGER NOT NULL DEFAULT 5 CHECK (re_offer_escalation_percent >= 0 AND re_offer_escalation_percent <= 20),
  -- Scoring weights (should sum to 100 for proper calculation)
  weight_listing_age INTEGER NOT NULL DEFAULT 50 CHECK (weight_listing_age >= 0 AND weight_listing_age <= 100),
  weight_stock_level INTEGER NOT NULL DEFAULT 15 CHECK (weight_stock_level >= 0 AND weight_stock_level <= 100),
  weight_item_value INTEGER NOT NULL DEFAULT 15 CHECK (weight_item_value >= 0 AND weight_item_value <= 100),
  weight_category INTEGER NOT NULL DEFAULT 10 CHECK (weight_category >= 0 AND weight_category <= 100),
  weight_watchers INTEGER NOT NULL DEFAULT 10 CHECK (weight_watchers >= 0 AND weight_watchers <= 100),
  last_auto_run_at TIMESTAMPTZ,
  last_auto_run_offers_sent INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user lookup
CREATE INDEX IF NOT EXISTS idx_negotiation_config_user ON negotiation_config(user_id);

-- ============================================================================
-- 2. negotiation_discount_rules - Score to discount percentage mapping
-- ============================================================================

CREATE TABLE IF NOT EXISTS negotiation_discount_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  min_score INTEGER NOT NULL CHECK (min_score >= 0 AND min_score <= 100),
  max_score INTEGER NOT NULL CHECK (max_score >= 0 AND max_score <= 100),
  discount_percentage INTEGER NOT NULL CHECK (discount_percentage >= 10 AND discount_percentage <= 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_score_range CHECK (min_score <= max_score)
);

-- Indexes for discount rules
CREATE INDEX IF NOT EXISTS idx_negotiation_rules_user ON negotiation_discount_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_negotiation_rules_score_range ON negotiation_discount_rules(user_id, min_score, max_score);

-- ============================================================================
-- 3. negotiation_offers - Audit log of all offers sent
-- ============================================================================

CREATE TABLE IF NOT EXISTS negotiation_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ebay_listing_id TEXT NOT NULL,
  listing_title TEXT,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  ebay_offer_id TEXT,
  buyer_masked_username TEXT,
  discount_percentage INTEGER NOT NULL CHECK (discount_percentage >= 10),
  original_price DECIMAL(10, 2),
  offer_price DECIMAL(10, 2),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  score_factors JSONB NOT NULL DEFAULT '{}',
  offer_message TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'FAILED')),
  is_re_offer BOOLEAN NOT NULL DEFAULT false,
  previous_offer_id UUID REFERENCES negotiation_offers(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'automated')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_user ON negotiation_offers(user_id);
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_listing ON negotiation_offers(ebay_listing_id);
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_status ON negotiation_offers(user_id, status);
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_sent ON negotiation_offers(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_inventory ON negotiation_offers(inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_negotiation_offers_trigger ON negotiation_offers(user_id, trigger_type, sent_at DESC);

-- ============================================================================
-- 4. Enable RLS on all negotiation tables
-- ============================================================================

ALTER TABLE negotiation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiation_discount_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiation_offers ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS Policies for negotiation_config
-- ============================================================================

CREATE POLICY "Users can view own negotiation config"
  ON negotiation_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own negotiation config"
  ON negotiation_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own negotiation config"
  ON negotiation_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own negotiation config"
  ON negotiation_config FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 6. RLS Policies for negotiation_discount_rules
-- ============================================================================

CREATE POLICY "Users can view own discount rules"
  ON negotiation_discount_rules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own discount rules"
  ON negotiation_discount_rules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own discount rules"
  ON negotiation_discount_rules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own discount rules"
  ON negotiation_discount_rules FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 7. RLS Policies for negotiation_offers
-- ============================================================================

CREATE POLICY "Users can view own negotiation offers"
  ON negotiation_offers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own negotiation offers"
  ON negotiation_offers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own negotiation offers"
  ON negotiation_offers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own negotiation offers"
  ON negotiation_offers FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 8. Helper function to get negotiation metrics
-- ============================================================================

CREATE OR REPLACE FUNCTION get_negotiation_metrics(p_user_id UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  total_offers_sent BIGINT,
  offers_accepted BIGINT,
  offers_declined BIGINT,
  offers_expired BIGINT,
  offers_pending BIGINT,
  acceptance_rate NUMERIC,
  avg_discount_sent NUMERIC,
  avg_discount_converted NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH offer_stats AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
      COUNT(*) FILTER (WHERE status = 'DECLINED') AS declined,
      COUNT(*) FILTER (WHERE status = 'EXPIRED') AS expired,
      COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
      AVG(discount_percentage) AS avg_discount,
      AVG(discount_percentage) FILTER (WHERE status = 'ACCEPTED') AS avg_discount_accepted
    FROM negotiation_offers
    WHERE user_id = p_user_id
      AND sent_at >= NOW() - (p_days || ' days')::INTERVAL
      AND status != 'FAILED'
  )
  SELECT
    os.total AS total_offers_sent,
    os.accepted AS offers_accepted,
    os.declined AS offers_declined,
    os.expired AS offers_expired,
    os.pending AS offers_pending,
    CASE WHEN os.total > 0
      THEN ROUND((os.accepted::NUMERIC / os.total) * 100, 1)
      ELSE 0
    END AS acceptance_rate,
    ROUND(COALESCE(os.avg_discount, 0), 1) AS avg_discount_sent,
    ROUND(COALESCE(os.avg_discount_accepted, 0), 1) AS avg_discount_converted
  FROM offer_stats os;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. Helper function to check if re-offer is allowed
-- ============================================================================

CREATE OR REPLACE FUNCTION can_re_offer(
  p_user_id UUID,
  p_ebay_listing_id TEXT,
  p_cooldown_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  can_send BOOLEAN,
  last_offer_date TIMESTAMPTZ,
  last_discount INTEGER,
  days_since_last INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH last_offer AS (
    SELECT
      no.sent_at,
      no.discount_percentage,
      EXTRACT(DAY FROM NOW() - no.sent_at)::INTEGER AS days_ago
    FROM negotiation_offers no
    WHERE no.user_id = p_user_id
      AND no.ebay_listing_id = p_ebay_listing_id
      AND no.status IN ('EXPIRED', 'DECLINED')
    ORDER BY no.sent_at DESC
    LIMIT 1
  )
  SELECT
    CASE
      WHEN lo.sent_at IS NULL THEN true
      WHEN lo.days_ago >= p_cooldown_days THEN true
      ELSE false
    END AS can_send,
    lo.sent_at AS last_offer_date,
    lo.discount_percentage AS last_discount,
    lo.days_ago AS days_since_last
  FROM (SELECT 1) AS dummy
  LEFT JOIN last_offer lo ON true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 10. Insert default discount rules for new users (trigger)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_default_discount_rules()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert default discount rules based on score ranges
  INSERT INTO negotiation_discount_rules (user_id, min_score, max_score, discount_percentage)
  VALUES
    (NEW.user_id, 0, 39, 10),    -- Low score: 10% discount
    (NEW.user_id, 40, 59, 15),   -- Medium-low score: 15% discount
    (NEW.user_id, 60, 79, 20),   -- Medium-high score: 20% discount
    (NEW.user_id, 80, 100, 25);  -- High score: 25% discount

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_default_discount_rules
  AFTER INSERT ON negotiation_config
  FOR EACH ROW
  EXECUTE FUNCTION create_default_discount_rules();
