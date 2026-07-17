import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, PackageSearch, TrendingUp } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PriceHistogramChart } from './PriceHistogramChart';
import { buildPriceHistogram } from './priceHistogram';
import { ColourSwatch } from './ColourSwatch';
import { blColour } from '@/lib/bricklink/bl-colours';
import { itemTypeLabel, bricklinkCatalogUrl } from './types';
import type { SummaryCacheRow, PriceGuideCacheRow, PovRow } from './types';

import { BRICQER_PRICE_FLOOR as BRICQER_FLOOR } from '@/lib/bricklink/bricqer-pricing';

const FLOOR_LABEL = `Bricqer floor (£${BRICQER_FLOOR.toFixed(4).replace(/0+$/, '')})`;

function QuadrantStat({ label, lots, qty, avg, min, max, str }: {
  label: string;
  lots: number | null;
  qty: number | null;
  avg: number | null;
  min?: number | null;
  max?: number | null;
  str?: number | null;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {str != null && (
          <Badge variant="outline" className={str >= 1.5 ? 'border-green-200 text-green-700 dark:border-green-900 dark:text-green-400' : ''}>
            STR {str.toFixed(2)}
          </Badge>
        )}
      </div>
      <div className="text-lg font-semibold tabular-nums">{qty?.toLocaleString() ?? '—'} <span className="text-xs font-normal text-muted-foreground">pcs</span></div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {lots?.toLocaleString() ?? '—'} lots · avg {formatCurrency(avg)}
        {min != null && max != null && <> · {formatCurrency(min)}–{formatCurrency(max)}</>}
      </div>
    </div>
  );
}

function L1Section({ row }: { row: SummaryCacheRow | null }) {
  if (!row) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">L1 — worldwide summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Not covered — gap-fill queued on the next refresh cycle.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">L1 — worldwide summary</CardTitle>
        <CardDescription>
          {row.currency}{row.fx_rate ? ` · fx ${row.fx_rate.toFixed(4)}` : ''} · {row.fetch_identity ?? 'unknown lane'} · fetched{' '}
          {formatDate(row.fetched_at)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuadrantStat label="Sold 6mo — New" lots={row.sold6m_new_lots} qty={row.sold6m_new_qty} avg={row.sold6m_new_avg} min={row.sold6m_new_min} max={row.sold6m_new_max} str={row.str_new} />
          <QuadrantStat label="Sold 6mo — Used" lots={row.sold6m_used_lots} qty={row.sold6m_used_qty} avg={row.sold6m_used_avg} min={row.sold6m_used_min} max={row.sold6m_used_max} str={row.str_used} />
          <QuadrantStat label="Stock — New" lots={row.stock_new_lots} qty={row.stock_new_qty} avg={row.stock_new_avg} min={row.stock_new_min} max={row.stock_new_max} />
          <QuadrantStat label="Stock — Used" lots={row.stock_used_lots} qty={row.stock_used_qty} avg={row.stock_used_avg} min={row.stock_used_min} max={row.stock_used_max} />
        </div>
      </CardContent>
    </Card>
  );
}

function L3Section({ row }: { row: PriceGuideCacheRow | null }) {
  if (!row) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">L3 — UK price-guide detail</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Not covered — gap-fill queued on the next catalogPG refresh cycle.</p>
        </CardContent>
      </Card>
    );
  }

  const hasHist = row.parse_version >= 3 && row.uk_detail?.soldNew?.hist != null;
  const soldNewHist = hasHist ? buildPriceHistogram(row.uk_detail?.soldNew.hist, BRICQER_FLOOR) : null;
  const soldUsedHist = hasHist ? buildPriceHistogram(row.uk_detail?.soldUsed.hist, BRICQER_FLOOR) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">L3 — UK price-guide detail</CardTitle>
        <CardDescription>
          parse v{row.parse_version} · fetched {formatDate(row.fetched_at)}
          {row.item_name && <> · {row.item_name}</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">UK sold 6mo — New</div>
            <div className="text-lg font-semibold tabular-nums">{row.uk_sold_qty_new.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">pcs</span></div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {row.uk_sold_lots_new.toLocaleString()} lots · avg {formatCurrency(row.uk_sold_avg_new)} · median {formatCurrency(row.uk_sold_median_new)}
            </div>
            <div className="text-xs text-muted-foreground">last-2mo {row.uk_sold_last2mo_qty_new.toLocaleString()} pcs</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">UK sold 6mo — Used</div>
            <div className="text-lg font-semibold tabular-nums">{row.uk_sold_qty_used.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">pcs</span></div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {row.uk_sold_lots_used.toLocaleString()} lots · avg {formatCurrency(row.uk_sold_avg_used)} · median {formatCurrency(row.uk_sold_median_used)}
            </div>
            <div className="text-xs text-muted-foreground">last-2mo {row.uk_sold_last2mo_qty_used.toLocaleString()} pcs</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">UK stock — New</div>
            <div className="text-lg font-semibold tabular-nums">{row.uk_stock_qty_new.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">pcs</span></div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {row.uk_stock_lots_new.toLocaleString()} lots · from {formatCurrency(row.uk_stock_min_new)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">UK stock — Used</div>
            <div className="text-lg font-semibold tabular-nums">{row.uk_stock_qty_used.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">pcs</span></div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {row.uk_stock_lots_used.toLocaleString()} lots · from {formatCurrency(row.uk_stock_min_used)}
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <TrendingUp className="h-4 w-4" />
            STR at my price — sold-price histogram
          </h4>
          {!hasHist ? (
            <p className="text-sm text-muted-foreground">Histogram pending next catalogPG refresh (this row is parse v{row.parse_version}, hist lands on v3+).</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">New</p>
                {soldNewHist ? (
                  <PriceHistogramChart histogram={soldNewHist} floorLabel={FLOOR_LABEL} />
                ) : (
                  <p className="text-sm text-muted-foreground">No priced new sold transactions.</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Used</p>
                {soldUsedHist ? (
                  <PriceHistogramChart histogram={soldUsedHist} floorLabel={FLOOR_LABEL} />
                ) : (
                  <p className="text-sm text-muted-foreground">No priced used sold transactions.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PovSection({ row }: { row: PovRow | null }) {
  if (!row) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageSearch className="h-4 w-4" />
          Part-out value (official BrickLink POV)
        </CardTitle>
        <CardDescription>
          {row.condition === 'N' ? 'New' : 'Used'} condition · fetched {formatDate(row.fetched_at)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Sold 6mo avg</div>
            <div className="text-lg font-semibold tabular-nums">{formatCurrency(row.sold_6mo_avg_gbp)}</div>
            <div className="text-xs text-muted-foreground">{row.sold_6mo_items ?? 0} items / {row.sold_6mo_lots ?? 0} lots</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">For sale avg</div>
            <div className="text-lg font-semibold tabular-nums">{formatCurrency(row.for_sale_avg_gbp)}</div>
            <div className="text-xs text-muted-foreground">{row.for_sale_items ?? 0} items / {row.for_sale_lots ?? 0} lots</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">UK RRP</div>
            <div className="text-lg font-semibold tabular-nums">{formatCurrency(row.uk_retail_gbp)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Part-out multiple</div>
            <div className="text-lg font-semibold tabular-nums">{row.partout_multiple != null ? `${row.partout_multiple.toFixed(2)}×` : '—'}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TupleDetail({
  itemType,
  itemNo,
  colourId,
  itemName,
  l1,
  l3,
  pov,
}: {
  itemType: string;
  itemNo: string;
  colourId: number;
  /**
   * Resolved via resolveItemName() by the drill-down route (bl_catalog_names
   * cache, falling back to a live BrickLink API lookup) — null when neither the
   * cache nor a live BL client were available. Non-fatal by design; the header
   * falls back gracefully below.
   */
  itemName: string | null;
  l1: SummaryCacheRow | null;
  l3: PriceGuideCacheRow | null;
  pov: PovRow | null;
}) {
  const notCovered = !l1 && !l3;
  // Resolved name first, then the L3 cache's own item_name (scraped alongside
  // the price-guide detail), then a synthesized "Part 3023 in Black" fallback
  // so the header never shows a bare, meaningless tuple.
  const displayName =
    itemName ?? l3?.item_name ?? `${itemTypeLabel(itemType)} ${itemNo}${colourId > 0 ? ` in ${blColour(colourId).name}` : ''}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="font-mono text-sm">{itemTypeLabel(itemType)}</Badge>
        <h2 className="font-mono text-xl font-semibold">{itemNo}</h2>
        {colourId > 0 && <ColourSwatch colourId={colourId} />}
        <span className="text-muted-foreground">{displayName}</span>
        {/* External — BrickLink's own catalogue page, new tab. Plain <a>, not next/link,
            since this leaves the app entirely (matches the ScreenTable row convention). */}
        <a
          href={bricklinkCatalogUrl(itemType, itemNo, colourId)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          View on BrickLink
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {notCovered && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Not covered by either cache layer yet — gap-fill queued on the next refresh cycle.
          </CardContent>
        </Card>
      )}

      <L1Section row={l1} />
      <L3Section row={l3} />
      <PovSection row={pov} />
    </div>
  );
}
