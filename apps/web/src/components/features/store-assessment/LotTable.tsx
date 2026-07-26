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
 * Every threshold shown is echoed from the assessment's own `inputs` or from
 * lib/bricklink/fees. This component must never introduce a cutoff of its own.
 */

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from 'lucide-react';
import type { ScoredLot } from '@/lib/bl-store-assessment/types';
import { bricklinkImageUrlByCode, bricklinkItemUrlByCode } from '@/lib/bricklink/catalogue-url';
import { SA, Fig, OverlapTag, fmtGbp, fmtPct } from './primitives';

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
  const href = bricklinkItemUrlByCode(s.itemType, s.itemNo, s.colourId);
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
          href={href}
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

/** One column: how it sorts, how it renders, and whether it survives a narrow screen. */
interface Col {
  key: string;
  label: string;
  title?: string;
  align: 'l' | 'r';
  /** Sort value; omitted for non-sortable columns (the item cell, the BUY flag). */
  sort?: (s: ScoredLot) => number | null;
  /** Default direction when the column is first clicked. */
  desc?: boolean;
  cell: (s: ScoredLot) => React.ReactNode;
  hideOnMobile?: boolean;
}

const COL: Record<string, Col> = {
  ask: {
    key: 'ask',
    label: 'Ask',
    align: 'r',
    desc: true,
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
    title: 'What WE would list it at (Bricqer model for parts/minifigs, sold avg for sets)',
    sort: (s) => s.ourList,
    cell: (s) => <Fig>{fmtGbp(s.ourList)}</Fig>,
  },
  net: {
    key: 'net',
    label: 'Net/u',
    align: 'r',
    desc: true,
    title: 'Net per unit after the 9.4% fee stack, ex-postage',
    sort: (s) => s.netPerUnit,
    cell: (s) => <Fig className="font-medium">{fmtGbp(s.netPerUnit)}</Fig>,
  },
  margin: {
    key: 'margin',
    label: 'Margin',
    align: 'r',
    desc: true,
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
    title: 'Clears the net-margin threshold for this run',
    cell: (s) =>
      s.withinMargin ? (
        <span className="text-xs font-semibold" style={{ color: SA.goodText }}>
          BUY
        </span>
      ) : null,
  },
};

const LAYOUT: Record<LotTableKind, { cols: string[]; sort: string }> = {
  // Buy list. STR joins it because the honesty ladder's liquid cut is an STR gate — a
  // buyable lot with no sell-through is exactly the money that headline strips out, and
  // the old table gave no way to see which rows those were.
  margin: {
    cols: ['ask', 'bench', 'list', 'net', 'margin', 'qty', 'str', 'overlap'],
    sort: 'lotProfit',
  },
  // Fast movers: the reconciling trio, in the order sold ÷ stock = STR reads.
  str: {
    cols: ['ask', 'qty', 'soldQty', 'stockQty', 'str', 'bench', 'overlap', 'buy'],
    sort: 'str',
  },
  // Magnets lead with the scarcity the gate actually uses; world lots trail as context.
  magnet: {
    cols: ['ask', 'qty', 'stockQty', 'str', 'world', 'lotProfit', 'overlap', 'buy'],
    sort: 'stockQty',
  },
};

/** Magnets rank scarcest-first; everything else ranks biggest-first. */
const DEFAULT_DESC: Record<LotTableKind, boolean> = { margin: true, str: true, magnet: false };
const DEFAULT_SORT_KEY: Record<LotTableKind, string> = {
  margin: 'lotProfit',
  str: 'str',
  magnet: 'stockQty',
};

function thClass(align: 'l' | 'r', hideOnMobile?: boolean) {
  return [
    'py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground',
    align === 'r' ? 'text-right' : 'text-left',
    hideOnMobile ? 'hidden md:table-cell' : '',
  ].join(' ');
}

/**
 * Sortable header. The active column shows a solid arrow and is emphasised, everything
 * else stays muted — the same affordance the part-out table uses, and the same reason:
 * a table that always renders one neutral glyph never says what it is ordered by.
 */
function SortHeader({
  col,
  active,
  desc,
  onClick,
}: {
  col: Col;
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-[0.1em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'font-semibold text-foreground' : ''}`}
    >
      {col.label}
      <Icon className={`h-3 w-3 ${active ? 'text-foreground' : 'text-muted-foreground/50'}`} />
    </button>
  );
}

export interface LotTableProps {
  rows: ScoredLot[];
  kind: LotTableKind;
  /** Total lots in this section, when more exist than were persisted. */
  totalLots?: number;
}

export function LotTable({ rows, kind, totalLots }: LotTableProps) {
  const [sortKey, setSortKey] = useState(DEFAULT_SORT_KEY[kind]);
  const [desc, setDesc] = useState(DEFAULT_DESC[kind]);

  const cols = useMemo(() => LAYOUT[kind].cols.map((k) => COL[k]), [kind]);

  const sorted = useMemo(() => {
    const col = COL[sortKey];
    if (!col?.sort) return rows;
    // Nulls always sink, in both directions — a lot with no STR is not the best-selling
    // lot in the store, and it is not the worst either. It is unmeasured.
    return [...rows].sort((a, b) => {
      const av = col.sort!(a);
      const bv = col.sort!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return desc ? bv - av : av - bv;
    });
  }, [rows, sortKey, desc]);

  if (!rows.length) return <p className="text-sm text-muted-foreground">None.</p>;

  const toggle = (col: Col) => {
    if (!col.sort) return;
    if (col.key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(col.key);
      setDesc(col.desc ?? true);
    }
  };

  const truncated = totalLots != null && totalLots > rows.length;

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={`${thClass('l')} sticky left-0 z-10 bg-background`}>Item</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`${thClass(c.align, c.hideOnMobile)} pl-3`}
                  title={c.title}
                  // aria-sort belongs on the column header, not the button inside it —
                  // screen readers announce it as a property of the column.
                  aria-sort={
                    c.sort && sortKey === c.key ? (desc ? 'descending' : 'ascending') : undefined
                  }
                >
                  {c.sort ? (
                    <SortHeader
                      col={c}
                      active={sortKey === c.key}
                      desc={desc}
                      onClick={() => toggle(c)}
                    />
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
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
        {/* No silent caps: sorting reorders what is here, and what is here is a slice. */}
        {truncated && (
          <p>
            Showing the engine&apos;s top {rows.length} of {totalLots!.toLocaleString()} — sorting
            reorders these rows, it does not reach the rest of the store.
          </p>
        )}
        {sorted.some((r) => r.priceSource === 'world') && (
          <p>† worldwide 6-mo avg, +11% UK calibration (no UK sold data for that lot)</p>
        )}
      </div>
    </div>
  );
}
