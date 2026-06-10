/**
 * Tests for computeSkuRelinkPlan — the pure SKU-based inventory relink planner.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSkuRelinkPlan,
  type SkuRelinkListing,
  type SkuRelinkInventoryItem,
} from '../ebay-stock.service';

const listing = (platformItemId: string, platformSku: string | null): SkuRelinkListing => ({
  platformItemId,
  platformSku,
});

const inv = (
  id: string,
  sku: string | null,
  ebayListingId: string | null
): SkuRelinkInventoryItem => ({ id, sku, ebayListingId });

describe('computeSkuRelinkPlan', () => {
  it('relinks a 1:1 SKU match whose listing id has drifted, and maps it', () => {
    const plan = computeSkuRelinkPlan(
      [listing('NEW111', 'SKU-A')],
      [inv('item-1', 'SKU-A', 'OLD000')]
    );

    expect(plan.relinks).toEqual([
      { inventoryItemId: 'item-1', oldListingId: 'OLD000', newListingId: 'NEW111' },
    ]);
    expect(plan.mappings).toEqual([{ ebaySku: 'SKU-A', inventoryItemId: 'item-1' }]);
    expect(plan.skippedAmbiguous).toBe(0);
  });

  it('maps but does not relink when the listing id already matches', () => {
    const plan = computeSkuRelinkPlan(
      [listing('SAME', 'SKU-A')],
      [inv('item-1', 'SKU-A', 'SAME')]
    );

    expect(plan.relinks).toEqual([]);
    expect(plan.mappings).toEqual([{ ebaySku: 'SKU-A', inventoryItemId: 'item-1' }]);
  });

  it('relinks (and maps) an inventory item that had no listing id', () => {
    const plan = computeSkuRelinkPlan([listing('NEW111', 'SKU-A')], [inv('item-1', 'SKU-A', null)]);

    expect(plan.relinks).toEqual([
      { inventoryItemId: 'item-1', oldListingId: null, newListingId: 'NEW111' },
    ]);
    expect(plan.mappings).toEqual([{ ebaySku: 'SKU-A', inventoryItemId: 'item-1' }]);
  });

  it('skips a SKU that maps to more than one live listing', () => {
    const plan = computeSkuRelinkPlan(
      [listing('L1', 'SKU-A'), listing('L2', 'SKU-A')],
      [inv('item-1', 'SKU-A', 'OLD')]
    );

    expect(plan.relinks).toEqual([]);
    expect(plan.mappings).toEqual([]);
    expect(plan.skippedAmbiguous).toBe(1);
  });

  it('skips a SKU that maps to more than one inventory item', () => {
    const plan = computeSkuRelinkPlan(
      [listing('L1', 'SKU-A')],
      [inv('item-1', 'SKU-A', 'OLD'), inv('item-2', 'SKU-A', 'OLD')]
    );

    expect(plan.relinks).toEqual([]);
    expect(plan.mappings).toEqual([]);
    expect(plan.skippedAmbiguous).toBe(1);
  });

  it('ignores inventory whose SKU is not currently active on eBay', () => {
    const plan = computeSkuRelinkPlan(
      [listing('L1', 'SKU-A')],
      [inv('item-1', 'SKU-A', 'L1'), inv('item-2', 'SKU-GONE', 'ENDED')]
    );

    // item-2's SKU has no live listing -> not touched, not ambiguous
    expect(plan.mappings).toEqual([{ ebaySku: 'SKU-A', inventoryItemId: 'item-1' }]);
    expect(plan.skippedAmbiguous).toBe(0);
  });

  it('ignores null/empty/whitespace SKUs on both sides', () => {
    const plan = computeSkuRelinkPlan(
      [listing('L1', null), listing('L2', '   ')],
      [inv('item-1', null, 'X'), inv('item-2', '  ', 'Y')]
    );

    expect(plan.relinks).toEqual([]);
    expect(plan.mappings).toEqual([]);
    expect(plan.skippedAmbiguous).toBe(0);
  });

  it('treats SKUs with surrounding whitespace as equal', () => {
    const plan = computeSkuRelinkPlan(
      [listing('NEW', '  SKU-A ')],
      [inv('item-1', 'SKU-A', 'OLD')]
    );

    expect(plan.relinks).toEqual([
      { inventoryItemId: 'item-1', oldListingId: 'OLD', newListingId: 'NEW' },
    ]);
  });
});
