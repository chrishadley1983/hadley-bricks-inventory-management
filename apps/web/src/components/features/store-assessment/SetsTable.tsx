'use client';

/**
 * Per-set decision table — sortable, with the margin the route would actually earn.
 *
 * Sets are a SEPARATE buying decision from the parts arbitrage (different capital and
 * velocity profile), and the engine scores them on their own channels: sell complete on
 * BrickLink, flip FBM on Amazon, or part out.
 *
 * MARGIN. `SetDecisionRow` persists nets but no margin, and a net alone doesn't say
 * whether £6.27 is a good trade — on a £32 Buy Box it is 19%, on a £12 one it would be
 * 52%. So margin is derived here, on the same basis the parts table uses and the same
 * basis Chris ratified for Amazon: NET AS A SHARE OF THE SALE PRICE, not of the cost.
 *
 *   FLIP-AMAZON  amazonNet ÷ amazonBuyBox           — sale price is on the row
 *   SELL-BL      blNet ÷ blSale, where blSale is back-solved from the engine's own
 *                identity blNet = blSale × (1 − VAR_FEE_PCT) − ask. Exact, not an
 *                estimate — but it IS an inversion of engine arithmetic done in the view,
 *                which is only acceptable because the fee constant comes from fees.ts.
 *                The durable fix is for the engine to persist the margin; that needs a
 *                re-scan before existing rows would show it.
 *   PART-OUT     no sale margin exists — POV is a signal, not a booked sale. Shown as —.
 *   SKIP         no route won, so there is no margin to quote.
 */

import { useMemo } from 'react';
import Image from 'next/image';
import type { SetDecisionRow } from '@/lib/bl-store-assessment/types';
import { VAR_FEE_PCT } from '@/lib/bricklink/fees';
import { bricklinkImageUrlByCode, bricklinkItemUrlByCode } from '@/lib/bricklink/catalogue-url';
import { SA, Fig, fmtGbp, fmtPct } from './primitives';
import { SortableHead, useTableSort, type SortCol } from './sortable';

const VERDICT_COLOUR: Record<SetDecisionRow['verdict'], string | undefined> = {
  'FLIP-AMAZON': SA.goodText,
  'SELL-BL': SA.infoText,
  'PART-OUT': SA.warnText,
  SKIP: undefined,
};

/** Net as a share of the winning route's sale price. Null when no route booked a sale. */
export function setMarginPct(r: SetDecisionRow): number | null {
  if (r.verdict === 'FLIP-AMAZON') {
    if (r.amazonNet == null || !r.amazonBuyBox) return null;
    return r.amazonNet / r.amazonBuyBox;
  }
  if (r.verdict === 'SELL-BL') {
    if (r.blNet == null) return null;
    const blSale = (r.blNet + r.ask) / (1 - VAR_FEE_PCT);
    return blSale > 0 ? r.blNet / blSale : null;
  }
  return null;
}

const COL: Record<string, SortCol<SetDecisionRow>> = {
  qty: {
    key: 'qty',
    label: 'Qty',
    align: 'r',
    desc: true,
    sort: (r) => r.invQty,
    cell: (r) => <Fig>{r.invQty}</Fig>,
  },
  ask: {
    key: 'ask',
    label: 'Ask',
    align: 'r',
    desc: true,
    title: 'Their unit price — what we pay',
    sort: (r) => r.ask,
    cell: (r) => <Fig>{fmtGbp(r.ask)}</Fig>,
  },
  blNet: {
    key: 'blNet',
    label: 'BL net',
    align: 'r',
    desc: true,
    hideOnMobile: true,
    title: 'Net per unit selling complete at the BrickLink 6-mo sold average, after 9.4% fees',
    sort: (r) => r.blNet,
    cell: (r) => <Fig>{fmtGbp(r.blNet)}</Fig>,
  },
  amazonBuyBox: {
    key: 'amazonBuyBox',
    label: 'Amz BB',
    align: 'r',
    desc: true,
    hideOnMobile: true,
    title: 'Amazon Buy Box — shown only when the ASIN mapping is trusted',
    sort: (r) => (r.asinTrusted ? r.amazonBuyBox : null),
    cell: (r) => <Fig>{r.asinTrusted ? fmtGbp(r.amazonBuyBox) : '—'}</Fig>,
  },
  amazonNet: {
    key: 'amazonNet',
    label: 'Amz net',
    align: 'r',
    desc: true,
    title: 'Net per unit flipping FBM at the Buy Box (referral + DST + VAT + shipping) — new only',
    sort: (r) => r.amazonNet,
    cell: (r) => <Fig>{fmtGbp(r.amazonNet)}</Fig>,
  },
  pov: {
    key: 'pov',
    label: 'POV',
    align: 'r',
    desc: true,
    title: 'Part-out value (condition-matched 6-mo sold basis) and its multiple of the ask',
    sort: (r) => r.povGbp,
    cell: (r) => (
      <>
        <Fig>{fmtGbp(r.povGbp)}</Fig>
        {r.povMultiple != null && (
          <span className="text-[11px] text-muted-foreground"> {r.povMultiple.toFixed(1)}×</span>
        )}
      </>
    ),
  },
  bestNet: {
    key: 'bestNet',
    label: 'Best net',
    align: 'r',
    desc: true,
    title: 'Net per unit on the winning channel (POV is a signal, not a net — excluded)',
    sort: (r) => r.bestNet,
    cell: (r) => <Fig className="font-medium">{fmtGbp(r.bestNet)}</Fig>,
  },
  margin: {
    key: 'margin',
    label: 'Margin',
    align: 'r',
    desc: true,
    title: 'Best net as a share of that route’s SALE price — the same basis as the parts table',
    sort: setMarginPct,
    cell: (r) => {
      const m = setMarginPct(r);
      return (
        <Fig className={m != null && m >= 0.2 ? 'font-medium' : undefined}>
          <span style={m != null && m >= 0.2 ? { color: SA.goodText } : undefined}>
            {fmtPct(m)}
          </span>
        </Fig>
      );
    },
  },
  lotNet: {
    key: 'lotNet',
    label: 'Lot net',
    align: 'r',
    desc: true,
    title: 'Best net × qty — what the whole lot is worth to us',
    sort: (r) => (r.bestNet == null ? null : r.bestNet * r.invQty),
    cell: (r) => <Fig>{r.bestNet == null ? '—' : fmtGbp(r.bestNet * r.invQty)}</Fig>,
  },
  route: {
    key: 'route',
    label: 'Route',
    align: 'l',
    title: 'Winning channel, or SKIP when none clears the threshold',
    cell: (r) => (
      <span
        className="whitespace-nowrap text-[11px] font-semibold"
        style={{ color: VERDICT_COLOUR[r.verdict] }}
      >
        {r.verdict}
      </span>
    ),
  },
};

const LAYOUT = [
  'qty',
  'ask',
  'blNet',
  'amazonBuyBox',
  'amazonNet',
  'pov',
  'bestNet',
  'margin',
  'lotNet',
  'route',
];

export function SetsTable({ rows, totalLots }: { rows: SetDecisionRow[]; totalLots: number }) {
  const cols = useMemo(() => LAYOUT.map((k) => COL[k]), []);
  // Persisted order is best-net desc; open on the same so the table doesn't silently
  // reorder itself relative to the summary strip above it.
  const { sorted, sortKey, desc, toggle } = useTableSort(rows, COL, 'bestNet', true);

  if (!rows.length) return null;

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <SortableHead
            cols={cols}
            firstLabel="Set"
            sortKey={sortKey}
            desc={desc}
            toggle={toggle}
          />
          <tbody>
            {sorted.map((r) => (
              <tr
                key={`${r.itemNo}:${r.condition}`}
                className="border-b border-border/50 hover:bg-muted/40"
              >
                <td className="sticky left-0 z-10 max-w-[13rem] border-r border-border/50 bg-background py-1.5 md:max-w-[20rem]">
                  <div className="flex items-center gap-2">
                    <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded bg-muted">
                      <Image
                        src={bricklinkImageUrlByCode('S', r.itemNo)}
                        alt=""
                        fill
                        sizes="36px"
                        className="object-contain"
                        unoptimized
                      />
                    </span>
                    <span className="min-w-0">
                      <a
                        href={bricklinkItemUrlByCode('S', r.itemNo)}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium underline-offset-4 hover:underline"
                      >
                        {r.itemNo}
                      </a>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {r.condition === 'N' ? 'New' : 'Used'}
                        {r.setName ? ` · ${r.setName}` : ''}
                      </span>
                    </span>
                  </div>
                </td>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`py-1.5 pl-3 ${c.align === 'r' ? 'text-right' : ''} ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalLots > rows.length && (
        <p className="text-[11px] text-muted-foreground">
          Showing the engine&apos;s top {rows.length} of {totalLots.toLocaleString()} set lots by
          net — the rest were scored but not saved, so sorting reorders these rows only.
        </p>
      )}
    </div>
  );
}
