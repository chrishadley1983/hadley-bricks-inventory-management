'use client';

import Link from 'next/link';
import { AlertCircle, ExternalLink, Settings } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency } from '@/lib/utils';
import type { BrickLinkPricingStats } from './SetDetailsCard';

interface SetLookupBricklinkModalProps {
  setNumber: string | null;
  setName: string | null;
  condition: 'new' | 'used';
  stats: BrickLinkPricingStats | null;
  isOpen: boolean;
  onClose: () => void;
}

/** BrickLink catalogue set page. Sets are keyed with a sequence suffix. */
export function bricklinkSetUrl(setNumber: string): string {
  const withSuffix = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(withSuffix)}`;
}

/** Price-guide tab of the same page. */
export function bricklinkPriceGuideUrl(setNumber: string): string {
  return `${bricklinkSetUrl(setNumber)}#T=P`;
}

const money = (v: number | null): string => (v == null ? '—' : formatCurrency(v));

/**
 * Parse BL's "March 2026" month keys so the list can be ordered newest-first.
 * Unparseable keys sort last rather than being dropped.
 */
function monthSortValue(key: string): number {
  const parsed = Date.parse(`1 ${key}`);
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * BrickLink drill-down for the Details tab.
 *
 * BrickLink was the only panel on this screen with no drill-down, which made it the
 * thinnest view of the platform that actually differentiates us. This shows the sold
 * side behind the asking prices, sell-through, cache freshness, the months BL has UK
 * sales on record, and a deep link out to the catalogue page.
 */
export function SetLookupBricklinkModal({
  setNumber,
  setName,
  condition,
  stats,
  isOpen,
  onClose,
}: SetLookupBricklinkModalProps) {
  const label = condition === 'new' ? 'New' : 'Used';
  const months = Object.entries(stats?.byMonth ?? {}).sort(
    (a, b) => monthSortValue(b[0]) - monthSortValue(a[0])
  );
  // The real span the sold columns cover, read off the dated rows rather than assumed.
  const soldSpan =
    months.length === 0
      ? null
      : months.length === 1
        ? months[0][0]
        : `${months[months.length - 1][0]} – ${months[0][0]}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            BrickLink (UK, {label})
            {setNumber && <span className="text-muted-foreground">· {setNumber}</span>}
            {stats?.freshnessDays != null && (
              <Badge variant="secondary" className="font-normal">
                cached {Math.round(stats.freshnessDays)}d ago
              </Badge>
            )}
          </DialogTitle>
          {setName && <p className="text-sm text-muted-foreground">{setName}</p>}
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          {stats?.status === 'not-configured' ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <Settings className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="space-y-2 text-sm text-amber-900">
                <p>{stats.message ?? 'BrickLink is not connected.'}</p>
                <Link href="/settings/integrations">
                  <Button variant="outline" size="sm">
                    Configure BrickLink
                  </Button>
                </Link>
              </div>
            </div>
          ) : stats?.status === 'error' ? (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div className="space-y-1 text-sm text-red-900">
                <p className="font-medium">BrickLink lookup failed</p>
                <p>{stats.message}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Currently for sale (asking)
                </h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatBlock label="Min" value={money(stats?.minPrice ?? null)} />
                  <StatBlock label="Avg" value={money(stats?.avgPrice ?? null)} />
                  <StatBlock label="Max" value={money(stats?.maxPrice ?? null)} />
                  <StatBlock label="Lots" value={String(stats?.lotCount ?? 0)} />
                </div>
              </div>

              <div>
                {/*
                  NOT labelled "last 6 months". The sold columns are whatever BrickLink's UK
                  sold table held at fetch time, and for a slow-moving set that can be years
                  old — 75192-1 New totals 4 pieces, all from Feb/Mar 2020, and those rows
                  reconcile exactly with soldAvg/soldQty. Stating the real span stops the
                  figure being read as recent demand.
                */}
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sold on BrickLink UK
                  {soldSpan && <span className="normal-case"> · {soldSpan}</span>}
                </h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatBlock label="Avg" value={money(stats?.soldAvg ?? null)} />
                  <StatBlock label="Median" value={money(stats?.soldMedian ?? null)} />
                  <StatBlock
                    label="Volume"
                    value={String(stats?.soldQty ?? 0)}
                    sub={`${stats?.soldLots ?? 0} lots`}
                  />
                  <StatBlock
                    label="STR"
                    value={stats?.strQty == null ? '—' : stats.strQty.toFixed(2)}
                    sub="sold ÷ stock, qty basis"
                  />
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Months with UK sales on record
                </h4>
                {months.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    BrickLink listed no dated {label.toLowerCase()} sales for this set.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="px-3 py-2 font-medium">Month</th>
                            <th className="px-3 py-2 text-right font-medium">Avg</th>
                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                            <th className="px-3 py-2 text-right font-medium">Lots</th>
                          </tr>
                        </thead>
                        <tbody>
                          {months.map(([month, m]) => (
                            <tr key={month} className="border-t">
                              <td className="px-3 py-2">{month}</td>
                              <td className="px-3 py-2 text-right font-mono">{money(m.avg)}</td>
                              <td className="px-3 py-2 text-right font-mono">{m.qty}</td>
                              <td className="px-3 py-2 text-right font-mono">{m.lots}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/*
                      Deliberately a dated list, not a trend line. These are only the months
                      BrickLink happened to have UK sales in — for most individual sets that
                      is one or two points, sometimes years apart. A line chart between them
                      would imply continuity that the data does not support.
                    */}
                    <p className="pt-2 text-xs text-muted-foreground">
                      Only months with recorded UK sales appear. Gaps are months with no sales,
                      not zero prices — so read this as dated evidence, not a trend.
                    </p>
                  </>
                )}
              </div>

              {stats?.status === 'no-data' && (
                <p className="text-sm text-muted-foreground">{stats.message}</p>
              )}
            </div>
          )}
        </ScrollArea>

        {setNumber && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Link href={bricklinkPriceGuideUrl(setNumber)} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="mr-1 h-4 w-4" />
                Price guide on BrickLink
              </Button>
            </Link>
            <Link href={bricklinkSetUrl(setNumber)} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm">
                <ExternalLink className="mr-1 h-4 w-4" />
                Catalogue page
              </Button>
            </Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
