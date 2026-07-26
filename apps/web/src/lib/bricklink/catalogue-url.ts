/**
 * BrickLink catalogue links.
 *
 * One place, because the URL shape differs by item type and the colour parameter is
 * only meaningful for parts — getting either wrong sends you to a blank catalogue page.
 * Previously inlined in PartoutTable and again in SetLookupBricklinkModal.
 */

import type { BrickLinkItemType } from './types';

/** Catalogue type code. SET keeps its sequence suffix; parts carry a colour. */
function typeCode(itemType: BrickLinkItemType): 'S' | 'M' | 'P' {
  if (itemType === 'SET') return 'S';
  if (itemType === 'MINIFIG') return 'M';
  return 'P';
}

/**
 * Catalogue page for a part / minifig / set.
 *
 * `colourId` is appended only for parts — minifigs and sets have no colour dimension,
 * and passing one filters the page to nothing.
 */
export function bricklinkItemUrl(item: {
  partType: BrickLinkItemType;
  partNumber: string;
  colourId?: number | null;
}): string {
  const code = typeCode(item.partType);
  const base = `https://www.bricklink.com/v2/catalog/catalogitem.page?${code}=${encodeURIComponent(
    item.partNumber
  )}`;
  return code === 'P' && item.colourId != null ? `${base}&C=${item.colourId}` : base;
}
