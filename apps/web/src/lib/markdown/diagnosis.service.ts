/**
 * Markdown aging helper.
 *
 * The unified pricing engine (lib/pricing/engine.ts) now owns diagnosis;
 * this module only provides the shared aging-days calculation.
 */

import type { InventoryItemForMarkdown } from './types';

/**
 * Days since the item went live on its current listing.
 * Unified clock: listing_date primary, then purchase_date, then created_at.
 */
export function calculateAgingDays(item: InventoryItemForMarkdown): number {
  const baseDate = item.listing_date || item.purchase_date || item.created_at;
  return Math.floor((Date.now() - new Date(baseDate).getTime()) / (1000 * 60 * 60 * 24));
}
