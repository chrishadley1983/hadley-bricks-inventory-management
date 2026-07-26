'use client';

/**
 * The lot table shared by every section of the store assessment.
 *
 * Split out of AssessmentView (and made a client component) for three reasons, all of
 * them alignment with the Set Lookup part-out screen:
 *
 *  1. QUANTITY, NOT LOTS. The engine gates `highStr` on `strQty` and sorts by it
 *     (engine.ts), and gates magnets on `ukStockQty` via UK_MAGNET — but the old table
 *     rendered `strLots` and `worldSupplyLots`. Each list was therefore ordered by one
 *     number and captioned with another, which is the njo0658 trap ("Stock 12 / Sold 6"
 *     against an STR of 0.02) that the part-out table already fixed. STR (qty), Stock qty
 *     and Sold qty now sit together so a row reconciles: sold ÷ stock = STR.
 *  2. IMAGES + LINKS. A part number is not a part. The part-out table, its magnets and
 *     its top lots all carry a thumbnail and a catalogue link; a store's lots did not.
 *  3. SORTS. The sections are engine-ranked top-N slices, and until now that ranking was
 *     the only order available. Sorting works over the rows present — the footer says
 *     how many of the store's lots those are, so a re-sorted table is never mistaken
 *     for the whole store.
 *
 * Every table also carries the ARITHMETIC BEHIND ITS FLAG (Chris, 2026-07-26: "What
 * decides if it is buyable? Margin at my Bricqer calculated price?"). List, Net/u and
 * Margin appear wherever a BUY appears, because a verdict you cannot check is the same
 * problem as a column that disagrees with its sort.
 *
 * Every threshold shown is echoed from the assessment's own `inputs` or from
 * lib/bricklink/fees. This component must never introduce a cutoff of its own.
 */

import { useMemo } from 'react';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import type { ScoredLot } from '@/lib/bl-store-assessment/types';
import { bricklinkImageUrlByCode, bricklinkItemUrlByCode } from '@/lib/bricklink/catalogue-url';
import { SA, Fig, OverlapTag, fmtGbp, fmtPct } from './primitives';
import { SortableHead, useTableSort, type SortCol } from './sortable';

export type LotTableKind = 'margin' | 'str' | 'magnet';

const numf = (n: number | null | undefined, dp = 2) => (n == null ? '—' : Number(n).toFixed(dp));
const int = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString());

/** Benchmark with provenance: † = worldwide fallback (+UK calibration applied). */
function Bench({ s }: { s: ScoredLot }) {
  return (
    <span
      title={
        s.priceSource === 'world' ? 'Worldwide 6-mo avg, +11% UK calibration' : 'UK 6-mo sold avg'
      }
    >
      {fmtGbp(s.benchmarkAvg)}
      {/* fixed-width marker slot keeps tabular digits aligned across UK/world rows */}
      <span className="inline-block w-[1ch] text-left align-super text-[10px] text-muted-foreground">
        {s.priceSource === 'world' ? '†' : ''}
      </span>
    </span>
  );
}

/**
 * Item cell — thumbnail, catalogue link, condition and name.
 *
 * `unoptimized` is deliberate: BrickLink serves a 404 page rather than an image for
 * catalogue ids it doesn't recognise, and routing those through the Next optimiser
 * turns a missing thumbnail into a server-side fetch error. The host is allow-listed
 * in next.config either way.
 */
function ItemCell({ s }: { s: ScoredLot }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded bg-muted">
        <Image
          src={bricklinkImageUrlByCode(s.itemType, s.itemNo, s.colourId)}
          alt=""
          fill
          sizes="36px"
          className="object-contain"
          unoptimized
        />
      </span>
      <span className="min-w-0">
        <a
          href={bricklinkItemUrlByCode(s.itemType, s.itemNo, s.colourId)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 truncate font-medium underline-offset-4 hover:underline"
          title={s.itemName}
        >
          <span className="truncate">
            {s.itemNo}
            {s.colourName ? ` · ${s.colourName}` : ''}
          </span>
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
        </a>
        <span className="block truncate text-[11px] text-muted-foreground">
          {s.condition === 'N' ? 'New' : 'Used'} · {s.itemName}
        </span>
      </span>
    </div>
  );
}

const COL: Record<string, SortCol<ScoredLot>> = {
  ask: {
    key: 'ask',
    label: 'Ask',
    align: 'r',
    desc: true,
    title: 'Their unit price — what we pay',
    sort: (s) => s.ask,
    cell: (s) => <Fig>{fmtGbp(s.ask)}</Fig>,
  },
  qty: {
    key: 'qty',
    label: 'Qty',
    align: 'r',
    desc: true,
    title: 'Units the seller holds in this lot',
    sort: (s) => s.invQty,
    cell: (s) => <Fig>{int(s.invQty)}</Fig>,
  },
  bench: {
    key: 'bench',
    label: '6MA',
    align: 'r',
    desc: true,
    hideOnMobile: true,
    title: '6-month sold average († = worldwide, +11% UK calibration)',
    sort: (s) => s.benchmarkAvg,
    cell: (s) => (
      <Fig>
        <Bench s={s} />
      </Fig>
    ),
  },
  list: {
    key: 'list',
    label: 'List',
    align: 'r',
    desc: true,
    hideOnMobile: true,
    title:
      'What WE would list it at — Bricqer formula on the 6MA for parts/minifigs, the 6MA itself for sets',
    sort: (s) => s.ourList,
    cell: (s) => <Fig>{fmtGbp(s.ourList)}</Fig>,
  },
  net: {
    key: 'net',
    label: 'Net/u',
    align: 'r',
    desc: true,
    title: 'List × (1 − 9.4% fees) − ask − inbound, per unit',
    sort: (s) => s.netPerUnit,
    cell: (s) => <Fig className="font-medium">{fmtGbp(s.netPerUnit)}</Fig>,
  },
  margin: {
    key: 'margin',
    label: 'Margin',
    align: 'r',
    desc: true,
    title:
      'Net ÷ our list price — net as a share of the SALE, not of the cost. This is the number the buy gate tests.',
    sort: (s) => s.marginPct,
    cell: (s) => <Fig>{fmtPct(s.marginPct)}</Fig>,
  },
  // The qty-basis STR the engine actually gates and ranks on. Rendered beside Stock qty
  // and Sold qty wherever there is room, so the ratio is checkable rather than asserted.
  str: {
    key: 'str',
    label: 'STR (qty)',
    align: 'r',
    desc: true,
    title: 'Sell-through, quantity basis: UK 6-mo sold qty ÷ UK stock qty',
    sort: (s) => s.strQty,
    cell: (s) => <Fig>{numf(s.strQty)}</Fig>,
  },
  stockQty: {
    key: 'stockQty',
    label: 'Stock qty',
    align: 'r',
    desc: true,
    title: 'UK stock quantity in PIECES — the magnet scarcity basis, not a seller count',
    sort: (s) => s.ukStockQty,
    cell: (s) => <Fig>{int(s.ukStockQty)}</Fig>,
  },
  soldQty: {
    key: 'soldQty',
    label: 'Sold qty',
    align: 'r',
    desc: true,
    title: 'UK 6-month sold quantity (pieces) — the STR numerator',
    sort: (s) => s.marketSoldQty6mo ?? null,
    cell: (s) => <Fig>{int(s.marketSoldQty6mo ?? null)}</Fig>,
  },
  // Demoted to context (types.ts: "context only now"). Kept because it is the only read
  // on competition outside the UK, but muted so it can never be mistaken for the gate.
  world: {
    key: 'world',
    label: 'World lots',
    align: 'r',
    desc: true,
    hideOnMobile: true,
    title:
      'Worldwide sellers holding this (item, colour, condition) — context only; the magnet gate is UK stock qty',
    sort: (s) => s.worldSupplyLots,
    cell: (s) => <Fig className="text-muted-foreground">{int(s.worldSupplyLots)}</Fig>,
  },
  // Same field, un-muted, for runs scored BEFORE the UK gate landed — on those it is not
  // context, it is what decided the list, and muting it would misrepresent the run.
  worldGate: {
    key: 'worldGate',
    label: 'World lots',
    align: 'r',
    desc: false,
    title: 'Worldwide sellers holding this — the scarcity gate this run was scored on',
    sort: (s) => s.worldSupplyLots,
    cell: (s) => <Fig className="font-medium">{int(s.worldSupplyLots)}</Fig>,
  },
  lotProfit: {
    key: 'lotProfit',
    label: 'Lot net',
    align: 'r',
    desc: true,
    title: 'Net per unit × qty — raw, before the demand cap',
    sort: (s) => s.lotProfit,
    cell: (s) => <Fig>{fmtGbp(s.lotProfit)}</Fig>,
  },
  overlap: {
    key: 'overlap',
    label: 'Overlap',
    align: 'l',
    title: 'vs OUR stock: NEW / R-OUT / R-THIN / DUP',
    sort: (s) =>
      s.overlap === 'NEW'
        ? 3
        : s.overlap === 'RESTOCK_OUT'
          ? 2
          : s.overlap === 'RESTOCK_THIN'
            ? 1
            : s.overlap === 'DUPLICATE'
              ? 0
              : null,
    desc: true,
    cell: (s) => <OverlapTag s={s} />,
  },
  buy: {
    key: 'buy',
    label: 'Buy?',
    align: 'l',
    title: 'Net > 0 and margin ≥ the run’s threshold, on an eligible lot (min ask, no damage note)',
    sort: (s) => (s.withinMargin ? 1 : 0),
    desc: true,
    cell: (s) =>
      s.withinMargin ? (
        <span className="text-xs font-semibold" style={{ color: SA.goodText }}>
          BUY
        </span>
      ) : null,
  },
};

const LAYOUT: Record<LotTableKind, string[]> = {
  // Buy list. STR joins it because the honesty ladder's liquid cut is an STR gate — a
  // buyable lot with no sell-through is exactly the money that headline strips out, and
  // the old table gave no way to see which rows those were.
  margin: ['ask', 'bench', 'list', 'net', 'margin', 'qty', 'str', 'overlap'],
  // Fast movers: the reconciling trio (sold ÷ stock = STR), then the buy arithmetic.
  str: [
    'ask',
    'qty',
    'soldQty',
    'stockQty',
    'str',
    'bench',
    'list',
    'net',
    'margin',
    'overlap',
    'buy',
  ],
  // Magnets lead with the scarcity the gate actually uses; world lots trail as context.
  magnet: [
    'ask',
    'qty',
    'stockQty',
    'str',
    'world',
    'list',
    'net',
    'margin',
    'lotProfit',
    'overlap',
    'buy',
  ],
};

/**
 * Layouts for runs with no UK stock quantity on their lots.
 *
 * `ukStockQty` arrived with the UK magnet gate on 2026-07-26 10:01; every assessment
 * persisted before that carries no such key. On those rows a Stock qty column is a column
 * of em-dashes, and for magnets it also hides the number that actually selected the list
 * — those were gated on worldwide seller lots, so that is what leads. Show each run for
 * what it was rather than for what the current engine would have done.
 */
const NO_UK_STOCK_LAYOUT: Partial<Record<LotTableKind, string[]>> = {
  str: ['ask', 'qty', 'soldQty', 'str', 'bench', 'list', 'net', 'margin', 'overlap', 'buy'],
  magnet: [
    'ask',
    'qty',
    'worldGate',
    'str',
    'list',
    'net',
    'margin',
    'lotProfit',
    'overlap',
    'buy',
  ],
};

/** Magnets rank scarcest-first; everything else ranks biggest-first. */
const DEFAULT_DESC: Record<LotTableKind, boolean> = { margin: true, str: true, magnet: false };
const DEFAULT_SORT_KEY: Record<LotTableKind, string> = {
  margin: 'lotProfit',
  str: 'str',
  magnet: 'stockQty',
};

export interface LotTableProps {
  rows: ScoredLot[];
  kind: LotTableKind;
  /** Total lots in this section, when more exist than were persisted. */
  totalLots?: number;
  /** False when the run predates ukStockQty (see NO_UK_STOCK_LAYOUT). */
  ukStock?: boolean;
}

export function LotTable({ rows, kind, totalLots, ukStock = true }: LotTableProps) {
  const layout = (!ukStock && NO_UK_STOCK_LAYOUT[kind]) || LAYOUT[kind];
  const worldMagnets = kind === 'magnet' && !ukStock;
  const cols = useMemo(() => layout.map((k) => COL[k]), [layout]);

  const { sorted, sortKey, desc, toggle } = useTableSort(
    rows,
    COL,
    worldMagnets ? 'worldGate' : DEFAULT_SORT_KEY[kind],
    DEFAULT_DESC[kind]
  );

  if (!rows.length) return <p className="text-sm text-muted-foreground">None.</p>;

  const truncated = totalLots != null && totalLots > rows.length;

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <SortableHead
            cols={cols}
            firstLabel="Item"
            sortKey={sortKey}
            desc={desc}
            toggle={toggle}
          />
          <tbody>
            {sorted.map((s) => (
              <tr key={s.invID} className="border-b border-border/50 hover:bg-muted/40">
                <td className="sticky left-0 z-10 max-w-[13rem] border-r border-border/50 bg-background py-1.5 md:max-w-[22rem]">
                  <ItemCell s={s} />
                </td>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`py-1.5 pl-3 ${c.align === 'r' ? 'text-right' : ''} ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}
                  >
                    {c.cell(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-0.5 text-[11px] text-muted-foreground">
        {/*
          No silent caps. The engine scores every lot in the store but persists only a
          top-N slice per section, so sorting reorders what was saved — it cannot reach a
          lot the run discarded. Without this line, sorting by Ask ascending reads as
          "the cheapest buyable lot in this store" when it is "the cheapest of the N the
          engine ranked highest".
        */}
        {truncated && (
          <p>
            Showing the engine&apos;s top {rows.length} of {totalLots!.toLocaleString()} — the rest
            were scored but not saved, so sorting reorders these rows only.
          </p>
        )}
        {sorted.some((r) => r.priceSource === 'world') && (
          <p>† worldwide 6-mo avg, +11% UK calibration (no UK sold data for that lot)</p>
        )}
      </div>
    </div>
  );
}
