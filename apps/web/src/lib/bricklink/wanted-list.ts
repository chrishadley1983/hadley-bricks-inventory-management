/**
 * BrickLink wanted-list XML — THE one builder.
 *
 * Lifted verbatim out of scripts/bl-basket.ts (2026-07-26) when the store assessment
 * needed to emit the same file. Every rule below was learned by having a live upload
 * rejected, so this is deliberately a MOVE rather than a second implementation: a
 * reimplementation would rediscover each of them the hard way.
 *
 * The input is a neutral `WantedSourceLot` — bl-basket's EnrichedItem satisfies it
 * structurally, and the assessment engine's ScoredLot maps onto it (note the marginPct
 * unit difference, documented on the field).
 */

export type WantedItemCode = 'P' | 'S' | 'M';
export type WantedCondition = 'N' | 'U';

/** The decision fields a wanted-list entry needs. Nothing about how they were derived. */
export interface WantedSourceLot {
  itemType: WantedItemCode;
  itemNo: string;
  colourId: number;
  condition: WantedCondition;
  invQty: number;
  /** Their asking price per unit. */
  unitPriceGBP: number;
  /** What WE would list it at. */
  listPrice: number | null;
  lotProfit: number | null;
  /** Quantity-basis sell-through. */
  sellThru: number;
  /** PERCENTAGE, not a fraction — 37.87 means 37.87% (bl-basket's convention; the
   * assessment engine stores 0.3787 and must multiply by 100 before calling in). */
  marginPct: number | null;
  ukSoldAvg: number | null;
  /** Months of supply. */
  mos: number | null;
}

const ceilP = (n: number) => Math.ceil(n * 100) / 100;
const floorP = (n: number) => Math.floor(n * 100) / 100;

/** Total variable fee stack — imported rather than re-declared. */
import { VAR_FEE_PCT } from './fees';

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * BL's wanted-list format treats (itemType, itemNo, colourId) as a unique key —
 * CONDITION does NOT discriminate: an upload with the same part/colour as both
 * N and U fails with "duplicate item/color combinations" (proven live 2026-07-13,
 * P 12885 c86 on the Air list). A single seller can also list the same
 * part/colour/condition as multiple inventory rows (different storage, remarks,
 * prices), each scraped as its own row. Before XML generation we group
 * ALL rows sharing (type, no, colour) so BL accepts the upload.
 *
 * Merge semantics:
 *   - MINQTY = sum of invQty (we still want every piece across the dupes)
 *   - MAXPRICE = max of the per-row gated ceiling (so the more expensive row
 *     stays eligible — BL fulfils greedily from cheapest, so the lower-priced
 *     row gets pulled first naturally)
 *   - CONDITION: the higher-profit condition wins; the dropped side's lot count
 *     is surfaced in the remarks for the human reviewing on BL
 *   - listPrice/lotProfit are the same across same-condition dupes (same UK 6MA
 *     × multiplier); across conditions we keep the higher-profit row's context
 */
export interface WantedEntry {
  itemType: WantedItemCode;
  itemNo: string;
  colourId: number;
  /** Always concrete — BL's uploader rejects entries without CONDITION ("null" error, live-proven 2026-07-13). */
  condition: WantedCondition;
  totalQty: number;
  maxPrice: number;
  listPrice: number;
  totalLotProfit: number;
  mergedFrom: number;
  highestAsk: number;
  /** Lots of the OTHER condition dropped from this entry (BL allows one entry per item/colour). */
  droppedOtherCondLots: number;
  // Decision context for the wanted-list REMARKS (same tuple ⇒ same values across merged rows).
  sellThru: number;
  marginPct: number | null;
  ukSoldAvg: number | null;
  mos: number | null;
}

export function dedupeWantedEntries(passed: WantedSourceLot[]): WantedEntry[] {
  // Two levels: same-condition rows merge fully; across conditions BL still only
  // allows ONE entry per (item, colour) AND the uploader requires a concrete
  // CONDITION (omitting it draws a "null" error — live-proven 2026-07-13). So per
  // tuple we keep the higher-profit condition's entry and surface the dropped
  // side's lot count in the remarks for the human reviewing on BL.
  const byCond = new Map<string, WantedEntry>();
  // Highest-profit row first, so each group's pricing/remarks context comes from it.
  const sorted = [...passed].sort((a, b) => (b.lotProfit ?? 0) - (a.lotProfit ?? 0));
  for (const l of sorted) {
    const listPrice = l.listPrice ?? l.unitPriceGBP;
    const breakEven = floorP(listPrice * (1 - VAR_FEE_PCT));
    const maxPrice = Math.max(
      Math.min(ceilP(l.unitPriceGBP * 1.05), breakEven),
      ceilP(l.unitPriceGBP)
    );
    const key = `${l.itemType}|${l.itemNo}|${l.colourId}|${l.condition}`;
    const existing = byCond.get(key);
    if (existing) {
      existing.totalQty += l.invQty;
      existing.maxPrice = Math.max(existing.maxPrice, maxPrice);
      existing.totalLotProfit += l.lotProfit ?? 0;
      existing.highestAsk = Math.max(existing.highestAsk, l.unitPriceGBP);
      existing.mergedFrom += 1;
    } else {
      byCond.set(key, {
        itemType: l.itemType,
        itemNo: l.itemNo,
        colourId: l.colourId,
        condition: l.condition,
        totalQty: l.invQty,
        maxPrice,
        listPrice,
        totalLotProfit: l.lotProfit ?? 0,
        mergedFrom: 1,
        highestAsk: l.unitPriceGBP,
        droppedOtherCondLots: 0,
        sellThru: l.sellThru,
        marginPct: l.marginPct,
        ukSoldAvg: l.ukSoldAvg,
        mos: l.mos,
      });
    }
  }
  // Collapse to one entry per (item, colour): keep the higher-profit condition.
  const byTuple = new Map<string, WantedEntry>();
  for (const e of byCond.values()) {
    const key = `${e.itemType}|${e.itemNo}|${e.colourId}`;
    const existing = byTuple.get(key);
    if (!existing) {
      byTuple.set(key, e);
    } else if (e.totalLotProfit > existing.totalLotProfit) {
      e.droppedOtherCondLots = existing.mergedFrom + existing.droppedOtherCondLots;
      byTuple.set(key, e);
    } else {
      existing.droppedOtherCondLots += e.mergedFrom;
    }
  }
  return Array.from(byTuple.values());
}

/** Skipped entries, reported so a shrunken list is never silent. */
export interface WantedXmlResult {
  xml: string;
  entries: number;
  /** (item, colour, condition) tuples that absorbed extra rows. */
  mergedTuples: number;
  collapsedRows: number;
  /** Item numbers dropped as un-uploadable (ambiguous CMF ids). */
  skipped: string[];
}

export function buildWantedXml(entries: WantedEntry[]): WantedXmlResult {
  const merged = entries.filter((e) => e.mergedFrom > 1);
  const skipped: string[] = [];
  const xml = ['<INVENTORY>'];
  for (const e of entries) {
    // Bare colNN "set" ids (ambiguous CMF identity from the scrape) don't exist in the
    // BL catalog — the upload rejects the whole file. Live-proven 2026-07-13 (col25).
    if (e.itemType === 'S' && /^col\d+$/i.test(e.itemNo)) {
      skipped.push(e.itemNo);
      continue;
    }
    xml.push('  <ITEM>');
    xml.push(`    <ITEMTYPE>${e.itemType}</ITEMTYPE>`);
    xml.push(`    <ITEMID>${escXml(e.itemNo)}</ITEMID>`);
    if (e.itemType === 'P') xml.push(`    <COLOR>${e.colourId}</COLOR>`);
    xml.push(`    <MAXPRICE>${e.maxPrice.toFixed(2)}</MAXPRICE>`);
    xml.push(`    <MINQTY>${e.totalQty}</MINQTY>`);
    xml.push(`    <CONDITION>${e.condition}</CONDITION>`); // always concrete — BL uploader "null"s without it
    xml.push('    <NOTIFY>N</NOTIFY>');
    // Decision context inline: reviewing the wanted list on BL is the last point where
    // each item is click-through-able to its catalog page / price guide — the cart isn't.
    const netPerUnit = e.listPrice > 0 ? e.totalLotProfit / e.totalQty : null;
    const parts = [
      netPerUnit != null
        ? `net ${netPerUnit.toFixed(2)}/u ${e.marginPct != null ? Math.round(e.marginPct) + '%' : ''}`.trim()
        : null,
      `STR ${e.sellThru.toFixed(2)}`,
      e.ukSoldAvg != null ? `6MA ${e.ukSoldAvg.toFixed(2)}` : null,
      e.mos != null ? `~${Math.round(e.mos)}mo` : null,
      `lot ${e.totalLotProfit.toFixed(2)}`,
      // "ask max" not "ask<=": BL's uploadXML.ajax hard-rejects (returnCode -1, no
      // message) any REMARKS containing a &lt; entity — bisected live 2026-07-14.
      e.mergedFrom > 1
        ? `ask max ${e.highestAsk.toFixed(2)} merged ${e.mergedFrom}`
        : `ask ${e.highestAsk.toFixed(2)}`,
      e.droppedOtherCondLots > 0
        ? `+${e.droppedOtherCondLots} ${e.condition === 'N' ? 'U' : 'N'} lot(s) in store (BL: 1 entry/item+colour)`
        : null,
    ].filter(Boolean);
    // Angle brackets stripped outright: even correctly-escaped &lt;/&gt; kill the upload.
    xml.push(`    <REMARKS>${escXml(parts.join(' | ').replace(/[<>]/g, ''))}</REMARKS>`);
    xml.push('  </ITEM>');
  }
  xml.push('</INVENTORY>');
  return {
    xml: xml.join('\n'),
    entries: entries.length - skipped.length,
    mergedTuples: merged.length,
    collapsedRows: merged.reduce((s, e) => s + (e.mergedFrom - 1), 0),
    skipped,
  };
}

export function generateWantedXml(passed: WantedSourceLot[]): WantedXmlResult {
  return buildWantedXml(dedupeWantedEntries(passed));
}
