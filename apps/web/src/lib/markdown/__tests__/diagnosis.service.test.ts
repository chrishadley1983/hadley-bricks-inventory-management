import { describe, it, expect } from 'vitest';
import { diagnoseItem, calculateAgingDays } from '../diagnosis.service';
import type { InventoryItemForMarkdown, MarkdownConfig, PricingData } from '../types';

const baseConfig: MarkdownConfig = {
  mode: 'review',
  amazon_step1_days: 60,
  amazon_step2_days: 90,
  amazon_step3_days: 120,
  amazon_step4_days: 150,
  amazon_step2_undercut_pct: 5,
  amazon_step3_undercut_pct: 10,
  ebay_step1_days: 60,
  ebay_step2_days: 90,
  ebay_step3_days: 120,
  ebay_step4_days: 150,
  ebay_step1_reduction_pct: 5,
  ebay_step2_reduction_pct: 10,
  amazon_fee_rate: 0.1836,
  ebay_fee_rate: 0.18,
  overpriced_threshold_pct: 10,
  low_demand_sales_rank: 100000,
  auction_default_duration_days: 7,
  auction_max_per_day: 2,
  auction_enabled: true,
};

function makeItem(overrides: Partial<InventoryItemForMarkdown> = {}): InventoryItemForMarkdown {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  return {
    id: 'item-1',
    user_id: 'user-1',
    set_number: '75192',
    item_name: 'Millennium Falcon',
    condition: 'New',
    status: 'LISTED',
    cost: 40,
    listing_value: 95,
    listing_platform: 'Amazon',
    listing_date: daysAgo(70),
    purchase_date: daysAgo(80),
    created_at: daysAgo(80),
    markdown_hold: false,
    amazon_asin: 'B01234',
    ebay_listing_id: null,
    sales_rank: 50000,
    ...overrides,
  };
}

const competitivePricing: PricingData = {
  marketPrice: 80,
  buyBoxPrice: 78,
  salesRank: 50000,
  was_price_90d: 80,
};

describe('diagnoseItem', () => {
  it('returns HOLDING for items with markdown_hold', () => {
    const item = makeItem({ markdown_hold: true });
    const result = diagnoseItem(item, competitivePricing, baseConfig, 200);
    expect(result.diagnosis).toBe('HOLDING');
    expect(result.reason).toContain('hold');
  });

  it('returns HOLDING for items below minimum age threshold', () => {
    const item = makeItem();
    const result = diagnoseItem(item, competitivePricing, baseConfig, 30);
    expect(result.diagnosis).toBe('HOLDING');
    expect(result.reason).toContain('below');
  });

  it('returns OVERPRICED when price is >10% above market', () => {
    const item = makeItem({ listing_value: 95 }); // 95 vs 80 market = 18.75% above
    const result = diagnoseItem(item, competitivePricing, baseConfig, 70);
    expect(result.diagnosis).toBe('OVERPRICED');
    expect(result.reason).toContain('above market');
  });

  it('returns LOW_DEMAND when price competitive but sales rank poor', () => {
    const item = makeItem({ listing_value: 82 }); // only 2.5% above market
    const pricing: PricingData = { ...competitivePricing, salesRank: 150000 };
    const result = diagnoseItem(item, pricing, baseConfig, 70);
    expect(result.diagnosis).toBe('LOW_DEMAND');
    expect(result.reason).toContain('sales rank');
  });

  it('returns HOLDING when no pricing data available', () => {
    const item = makeItem();
    const noPricing: PricingData = { marketPrice: null, buyBoxPrice: null, salesRank: null, was_price_90d: null };
    const result = diagnoseItem(item, noPricing, baseConfig, 70);
    expect(result.diagnosis).toBe('HOLDING');
    expect(result.reason).toContain('Insufficient');
  });

  it('returns HOLDING when item missing cost', () => {
    const item = makeItem({ cost: null });
    const result = diagnoseItem(item, competitivePricing, baseConfig, 70);
    expect(result.diagnosis).toBe('HOLDING');
  });

  it('returns LOW_DEMAND for competitive price aged >120 days', () => {
    const item = makeItem({ listing_value: 82 }); // competitive
    const pricing: PricingData = { ...competitivePricing, salesRank: 50000 }; // rank OK
    const result = diagnoseItem(item, pricing, baseConfig, 130);
    expect(result.diagnosis).toBe('LOW_DEMAND');
    expect(result.reason).toContain('competitive price');
  });
});

describe('calculateAgingDays', () => {
  it('uses listing_date as primary source', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
    const item = makeItem({ listing_date: daysAgo(45), purchase_date: daysAgo(60) });
    expect(calculateAgingDays(item)).toBe(45);
  });

  it('falls back to purchase_date', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
    const item = makeItem({ listing_date: null, purchase_date: daysAgo(60) });
    expect(calculateAgingDays(item)).toBe(60);
  });

  it('falls back to created_at', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
    const item = makeItem({ listing_date: null, purchase_date: null, created_at: daysAgo(90) });
    expect(calculateAgingDays(item)).toBe(90);
  });
});
