/**
 * BrickLink catalogue links and item images.
 *
 * One place, because the URL shape differs by item type and the colour parameter is
 * only meaningful for parts — getting either wrong sends you to a blank catalogue page
 * or a broken thumbnail. Previously inlined in PartoutTable, SetLookupBricklinkModal
 * and (for images) partout.service.
 *
 * Two entry points per URL: one taking the verbose `BrickLinkItemType` the part-out
 * pipeline carries, one taking the single-letter code the store-assessment engine uses.
 * They are the same catalogue — a store lot and a part-out lot must never resolve to
 * different pages for the same item.
 */

import type { BrickLinkItemType } from './types';

/** Single-letter catalogue/price-guide type code — the store-assessment `ItemTypeCode`. */
export type BrickLinkTypeCode = 'P' | 'M' | 'S';

/** Catalogue type code. SET keeps its sequence suffix; parts carry a colour. */
function typeCode(itemType: BrickLinkItemType): BrickLinkTypeCode {
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
export function bricklinkItemUrlByCode(
  code: BrickLinkTypeCode,
  itemNo: string,
  colourId?: number | null
): string {
  const base = `https://www.bricklink.com/v2/catalog/catalogitem.page?${code}=${encodeURIComponent(
    itemNo
  )}`;
  return code === 'P' && colourId != null ? `${base}&C=${colourId}` : base;
}

export function bricklinkItemUrl(item: {
  partType: BrickLinkItemType;
  partNumber: string;
  colourId?: number | null;
}): string {
  return bricklinkItemUrlByCode(typeCode(item.partType), item.partNumber, item.colourId);
}

/**
 * Item thumbnail.
 *
 * The colour segment is the part's colour for P, and a literal 0 for minifigs and sets —
 * BL has no colour dimension for those and any other value 404s. Sets additionally need
 * their sequence suffix (`75192` → `75192-1`); store scrapes carry it inconsistently, so
 * it is normalised here on the same rule sets-intel uses.
 */
export function bricklinkImageUrlByCode(
  code: BrickLinkTypeCode,
  itemNo: string,
  colourId?: number | null
): string {
  const no = code === 'S' && !itemNo.includes('-') ? `${itemNo}-1` : itemNo;
  const colour = code === 'P' ? (colourId ?? 0) : 0;
  return `https://img.bricklink.com/ItemImage/${code}N/${colour}/${encodeURIComponent(no)}.png`;
}

export function bricklinkImageUrl(item: {
  partType: BrickLinkItemType;
  partNumber: string;
  colourId?: number | null;
}): string {
  return bricklinkImageUrlByCode(typeCode(item.partType), item.partNumber, item.colourId);
}
