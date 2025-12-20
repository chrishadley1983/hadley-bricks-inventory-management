-- Initial database schema for Hadley Bricks Inventory System
-- Migration: 20241219000001_initial_schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROFILES TABLE (extends Supabase auth.users)
-- ============================================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT,
  home_postcode TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INVENTORY ITEMS TABLE
-- ============================================================================
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  set_number TEXT NOT NULL,
  item_name TEXT,
  condition TEXT CHECK (condition IN ('New', 'Used')),
  status TEXT DEFAULT 'NOT YET RECEIVED',
  source TEXT,
  purchase_date DATE,
  cost DECIMAL(10,2),
  listing_date DATE,
  listing_value DECIMAL(10,2),
  storage_location TEXT,
  sku TEXT,
  linked_lot TEXT,
  amazon_asin TEXT,
  listing_platform TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- PURCHASES TABLE
-- ============================================================================
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purchase_date DATE NOT NULL,
  short_description TEXT NOT NULL,
  cost DECIMAL(10,2) NOT NULL,
  source TEXT,
  payment_method TEXT,
  description TEXT,
  reference TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- PLATFORM CREDENTIALS TABLE (encrypted API credentials per user)
-- ============================================================================
CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  credentials_encrypted BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, platform)
);

-- ============================================================================
-- PLATFORM ORDERS TABLE (unified across all platforms)
-- ============================================================================
CREATE TABLE platform_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_order_id TEXT NOT NULL,
  order_date TIMESTAMPTZ,
  buyer_name TEXT,
  status TEXT,
  subtotal DECIMAL(10,2),
  shipping DECIMAL(10,2),
  fees DECIMAL(10,2),
  total DECIMAL(10,2),
  currency TEXT DEFAULT 'GBP',
  raw_data JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, platform_order_id)
);

-- ============================================================================
-- FINANCIAL TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'fee', 'refund', 'payout')),
  platform TEXT,
  order_id UUID REFERENCES platform_orders(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- USER SETTINGS TABLE
-- ============================================================================
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_options TEXT[] DEFAULT ARRAY['eBay', 'FB Marketplace', 'BL', 'Amazon'],
  payment_methods TEXT[] DEFAULT ARRAY['HSBC - Cash', 'Monzo - Card', 'PayPal'],
  google_sheets_config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_inventory_user ON inventory_items(user_id);
CREATE INDEX idx_inventory_status ON inventory_items(user_id, status);
CREATE INDEX idx_inventory_sku ON inventory_items(user_id, sku);
CREATE INDEX idx_inventory_asin ON inventory_items(user_id, amazon_asin);
CREATE INDEX idx_purchases_user_date ON purchases(user_id, purchase_date DESC);
CREATE INDEX idx_orders_user_platform ON platform_orders(user_id, platform);
CREATE INDEX idx_orders_date ON platform_orders(user_id, order_date DESC);
CREATE INDEX idx_transactions_user_date ON financial_transactions(user_id, transaction_date DESC);
CREATE INDEX idx_platform_credentials_user ON platform_credentials(user_id);

-- ============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_items_updated_at
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platform_credentials_updated_at
  BEFORE UPDATE ON platform_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PROFILE CREATION TRIGGER (auto-create profile on user signup)
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
