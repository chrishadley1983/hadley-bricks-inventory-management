import { describe, it, expect } from 'vitest';
import { generateProposal, calculatePriceFloor } from '../markdown-engine.service';
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

function makeItem(
  overrides: Partial<InventoryItemForMarkdown> = {},
  daysListed: number = 70
): InventoryItemForMarkdown {
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
    listing_date: daysAgo(daysListed),
    purchase_date: daysAgo(daysListed + 10),
    created_at: daysAgo(daysListed + 10),
    markdown_hold: false,
    amazon_asin: 'B01234',
    ebay_listing_id: null,
    sales_rank: 50000,
    ...overrides,
  };
}

describe('calculatePriceFloor', () => {
  it('calculates Amazon floor correctly', () => {
    // cost £40, fee 18.36% → floor = 40 / (1 - 0.1836) = 40 / 0.8164 = 48.99
    const floor = calculatePriceFloor(40, 0.1836);
    expect(floor).toBeCloseTo(48.99, 0);
  });

  it('calculates eBay floor correctly', () => {
    // cost £40, fee 18% → floor = 40 / (1 - 0.18) = 40 / 0.82 = 48.78
    const floor = calculatePriceFloor(40, 0.18);
    expect(floor).toBeCloseTo(48.78, 0);
  });

  it('returns 0 for zero cost', () => {
    expect(calculatePriceFloor(0, 0.18)).toBe(0);
  });
});

describe('generateProposal - Amazon', () => {
  const amazonPricing: PricingData = {
    marketPrice: 80,
    buyBoxPrice: 78,
    salesRank: 50000,
    was_price_90d: 80,
  };

  it('returns null for held items', () => {
    const item = makeItem({ markdown_hold: true });
    expect(generateProposal(item, amazonPricing, baseConfig, 'review')).toBeNull();
  });

  it('returns null for items below age threshold', () => {
    const item = makeItem({}, 30); // 30 days < 60 threshold
    expect(generateProposal(item, amazonPricing, baseConfig, 'review')).toBeNull();
  });

  it('step 1 (60d): matches market with charm price', () => {
    const item = makeItem({ listing_value: 95 }, 65);
    const proposal = generateProposal(item, amazonPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.proposed_action).toBe('MARKDOWN');
    expect(proposal!.markdown_step).toBe(1);
    // Market £80, charm rounded → £79.99
    expect(proposal!.proposed_price).toBe(79.99);
  });

  it('step 2 (90d): undercuts market by 5%', () => {
    const item = makeItem({ listing_value: 95 }, 95);
    const proposal = generateProposal(item, amazonPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.markdown_step).toBe(2);
    // Market £80 * 0.95 = £76, charm → £75.99
    expect(proposal!.proposed_price).toBe(75.99);
  });

  it('step 3 (120d): undercuts market by 10%', () => {
    const item = makeItem({ listing_value: 95 }, 125);
    const proposal = generateProposal(item, amazonPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.markdown_step).toBe(3);
    // Market £80 * 0.90 = £72, charm → £71.99
    expect(proposal!.proposed_price).toBe(71.99);
  });

  it('step 4 (150d): floor price', () => {
    const item = makeItem({ listing_value: 95 }, 155);
    const proposal = generateProposal(item, amazonPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.markdown_step).toBe(4);
    // Floor = 40 / 0.8164 = £48.99, charm → £48.99
    expect(proposal!.proposed_price).toBeGreaterThanOrEqual(48.49);
    expect(proposal!.proposed_price).toBeLessThanOrEqual(49.49);
  });

  it('never goes below price floor', () => {
    // Expensive item with low cost
    const item = makeItem({ cost: 70, listing_value: 95 }, 155);
    const proposal = generateProposal(item, amazonPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    // Floor = 70 / 0.8164 = £85.74
    const floor = calculatePriceFloor(70, 0.1836);
    expect(proposal!.proposed_price).toBeGreaterThanOrEqual(floor - 1); // account for charm rounding
  });

  it('auto mode marks OVERPRICED as AUTO_APPLIED', () => {
    const item = makeItem({ listing_value: 95 }, 65);
    const proposal = generateProposal(item, amazonPricing, baseConfig, 'auto');
    expect(proposal!.status).toBe('AUTO_APPLIED');
  });

  it('review mode marks everything as PENDING', () => {
    const item = makeItem({ listing_value: 95 }, 65);
    const proposal = generateProposal(item, amazonPricing, baseConfig, 'review');
    expect(proposal!.status).toBe('PENDING');
  });
});

describe('generateProposal - eBay', () => {
  const ebayPricing: PricingData = {
    marketPrice: 80,
    buyBoxPrice: null,
    salesRank: null,
    was_price_90d: null,
  };

  it('step 1 (60d): reduces by 5%', () => {
    const item = makeItem({ listing_platform: 'eBay', listing_value: 95, ebay_listing_id: 'e123' }, 65);
    const proposal = generateProposal(item, ebayPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.platform).toBe('ebay');
    expect(proposal!.markdown_step).toBe(1);
    // 95 * 0.95 = 90.25, charm → 89.99
    expect(proposal!.proposed_price).toBe(89.99);
  });

  it('step 2 (90d): reduces by 10%', () => {
    const item = makeItem({ listing_platform: 'eBay', listing_value: 95, ebay_listing_id: 'e123' }, 95);
    const proposal = generateProposal(item, ebayPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.markdown_step).toBe(2);
    // 95 * 0.90 = 85.50, charm → 85.49
    expect(proposal!.proposed_price).toBe(85.49);
  });

  it('step 4 (150d): recommends AUCTION', () => {
    const item = makeItem({ listing_platform: 'eBay', listing_value: 95, ebay_listing_id: 'e123' }, 155);
    const proposal = generateProposal(item, ebayPricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.proposed_action).toBe('AUCTION');
    expect(proposal!.auction_duration_days).toBe(7);
  });

  it('LOW_DEMAND on eBay goes to AUCTION', () => {
    const item = makeItem({ listing_platform: 'eBay', listing_value: 82, ebay_listing_id: 'e123' }, 65);
    const pricing: PricingData = { ...ebayPricing, salesRank: 150000 };
    const proposal = generateProposal(item, pricing, baseConfig, 'review');
    expect(proposal).not.toBeNull();
    expect(proposal!.diagnosis).toBe('LOW_DEMAND');
    expect(proposal!.proposed_action).toBe('AUCTION');
  });

  it('auto mode keeps AUCTION proposals as PENDING', () => {
    const item = makeItem({ listing_platform: 'eBay', listing_value: 95, ebay_listing_id: 'e123' }, 155);
    const proposal = generateProposal(item, ebayPricing, baseConfig, 'auto');
    expect(proposal!.proposed_action).toBe('AUCTION');
    expect(proposal!.status).toBe('PENDING'); // auction always needs review
  });
});
