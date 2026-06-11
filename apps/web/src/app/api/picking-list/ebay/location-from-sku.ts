/**
 * eBay SKUs encode the at-listing location as "U<id> - <location>"
 * (e.g. "U2222 - Garage - E1"). The location may be stale if the item
 * was moved after listing, so it is only a fallback — never an override
 * of inventory storage_location.
 */
export function locationFromSku(sku: string | null): string | null {
  if (!sku) return null;
  const match = sku.match(/^U\d+\s*-\s*(.+)$/i);
  const location = match?.[1].trim();
  return location ? location : null;
}
