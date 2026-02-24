import type { PriceResult } from './types';

/**
 * Round price down to X.99 format (e.g. 44.99, 24.99).
 * For prices under £10, round to X.49 or X.99.
 */
function roundToX99(price: number): number {
  if (price < 1) return 0.99;
  return Math.floor(price) - 0.01;
}

/**
 * Calculate independent Shopify price from the marketplace listing price.
 *
 * Direct sales have lower fees (~2% Shopify Payments vs ~12% eBay / ~15% Amazon),
 * so we price lower for better margins while still making more per sale.
 *
 * @param listingValue - The eBay/Amazon listing price
 * @param discountPct - Percentage discount for direct sales (default 10%)
 * @returns Price and compare_at_price for Shopify
 */
export function calculateShopifyPrice(
  listingValue: number,
  discountPct = 10
): PriceResult {
  if (!listingValue || listingValue <= 0) {
    return { price: 0, compare_at_price: null };
  }

  const discounted = listingValue * (1 - discountPct / 100);
  const shopifyPrice = roundToX99(discounted);

  return {
    price: Math.max(shopifyPrice, 0.99),
    compare_at_price: null,
  };
}

/**
 * Format a price for Shopify's API (string with 2 decimal places).
 */
export function formatShopifyPrice(price: number): string {
  return price.toFixed(2);
}
