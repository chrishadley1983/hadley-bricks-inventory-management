import { describe, it, expect } from 'vitest';
import { calculateAgingDays } from '../diagnosis.service';
import type { InventoryItemForMarkdown } from '../types';

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function item(overrides: Partial<InventoryItemForMarkdown>): InventoryItemForMarkdown {
  return {
    id: 'i1',
    user_id: 'u1',
    set_number: '00000',
    item_name: 'Test',
    condition: 'new',
    status: 'LISTED',
    cost: 5,
    listing_value: 20,
    listing_platform: 'ebay',
    listing_date: null,
    purchase_date: null,
    created_at: daysAgoISO(0),
    markdown_hold: false,
    amazon_asin: null,
    ebay_listing_id: null,
    sales_rank: null,
    next_markdown_eval_at: null,
    ...overrides,
  };
}

describe('calculateAgingDays', () => {
  it('uses listing_date when present', () => {
    const age = calculateAgingDays(item({ listing_date: daysAgoISO(40) }));
    expect(age).toBeGreaterThanOrEqual(39);
    expect(age).toBeLessThanOrEqual(40);
  });

  it('falls back to purchase_date when no listing_date', () => {
    const age = calculateAgingDays(item({ listing_date: null, purchase_date: daysAgoISO(15) }));
    expect(age).toBeGreaterThanOrEqual(14);
    expect(age).toBeLessThanOrEqual(15);
  });

  it('falls back to created_at when neither set', () => {
    const age = calculateAgingDays(
      item({ listing_date: null, purchase_date: null, created_at: daysAgoISO(7) })
    );
    expect(age).toBeGreaterThanOrEqual(6);
    expect(age).toBeLessThanOrEqual(7);
  });
});
