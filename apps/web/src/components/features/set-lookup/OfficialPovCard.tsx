'use client';

import { RefreshCw, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import {
  useOfficialPov,
  useRefreshOfficialPov,
  type OfficialPovRow,
} from '@/hooks/useOfficialPov';
import type { PartoutAssessment, PartoutCondition } from '@/types/partout';

interface OfficialPovCardProps {
  setNumber: string | null;
  enabled: boolean;
  /** Driven by the Partout tab's single New/Used toggle — this card has no toggle of its own. */
  condition: PartoutCondition;
  /**
   * Our assessment for the SAME condition, when it has loaded. Supplied so the card can
   * state, in figures, how BrickLink's number relates to ours instead of leaving two
   * unexplained POVs on screen.
   */
  assessment?: PartoutAssessment | null;
}

const n = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return isFinite(x) ? x : null;
};
const money = (v: number | string | null | undefined, ccy: string | null): string => {
  const x = n(v);
  if (x == null) return '—';
  const sym = ccy === 'USD' ? '$' : '£';
  return `${sym}${x.toFixed(2)}`;
};
const gbp = (v: number | string | null | undefined): string => {
  const x = n(v);
  return x == null ? '—' : `£${x.toFixed(2)}`;
};
const fmtAge = (ms: number): string => {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

/** BL's sold figure in GBP — the native column when it already is GBP, else the converted one. */
function soldGbp(row: OfficialPovRow | undefined): number | null {
  if (!row) return null;
  const ccy = row.native_currency ?? 'GBP';
  return ccy === 'GBP' ? n(row.sold_6mo_native) : n(row.sold_6mo_avg_gbp);
}

/**
 * The reconciliation. Two POV figures on one screen is the single most confusing thing
 * about this tab, so the difference is stated in numbers rather than left to the reader:
 *
 *  - BL's published POV is the same KIND of number as our Gross rung (every lot at guide
 *    price, before fees). It should land close to it; a wide gap is a data signal.
 *  - Our decision figure is Net, after the liquidity haircut and the fee stack.
 *  - The two multiples share no denominator: BL divides by UK RRP, we divide by what the
 *    complete set actually costs today.
 */
function Reconciliation({
  row,
  assessment,
}: {
  row: OfficialPovRow | undefined;
  assessment?: PartoutAssessment | null;
}) {
  if (!assessment) return null;

  const blSold = soldGbp(row);
  const ourGross = assessment.grossPov;
  const delta = blSold != null && ourGross > 0 ? (ourGross - blSold) / blSold : null;
  const blMultiple = n(row?.partout_multiple);
  const rrp = n(row?.uk_retail_gbp);

  return (
    <div className="mt-4 space-y-2 border-t pt-3 text-xs text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">How this squares with the assessment.</span>{' '}
        {blSold != null ? (
          <>
            BrickLink&apos;s <strong>{formatCurrency(blSold)}</strong> is the same kind of figure as
            our <strong>Gross POV</strong> ({formatCurrency(ourGross)}
            {delta != null && (
              <>
                , {Math.abs(delta) < 0.005 ? 'in line' : `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`}
              </>
            )}
            ) — every lot at guide price, before fees.
          </>
        ) : (
          <>
            BrickLink&apos;s published POV is the same kind of figure as our{' '}
            <strong>Gross POV</strong> ({formatCurrency(ourGross)}) — every lot at guide price,
            before fees.
          </>
        )}{' '}
        Neither is money we would see. The decision figure is our{' '}
        <strong>Net {formatCurrency(assessment.netPov)}</strong>, after the{' '}
        {(assessment.captureRate * 100).toFixed(0)}% liquidity capture and{' '}
        {(assessment.feePct * 100).toFixed(1)}% fees.
      </p>
      {(blMultiple != null || assessment.povMultiple != null) && (
        <p>
          The multiples are not comparable:{' '}
          {blMultiple != null ? (
            <>
              BrickLink&apos;s <strong>{blMultiple.toFixed(2)}×</strong> divides by UK RRP
              {rrp != null && <> ({formatCurrency(rrp)})</>}
            </>
          ) : (
            <>BrickLink divides by UK RRP</>
          )}
          ;{' '}
          {assessment.povMultiple != null ? (
            <>
              ours <strong>{assessment.povMultiple.toFixed(2)}×</strong> divides by what the complete
              set costs today
              {assessment.setPrice != null && <> ({formatCurrency(assessment.setPrice)})</>}
            </>
          ) : (
            <>ours divides by what the complete set costs today, which has no price here</>
          )}
          . Only ours drives the gate.
        </p>
      )}
    </div>
  );
}

/**
 * BrickLink's own Part Out Value — a CROSS-CHECK on the assessment above, not a second
 * verdict. BL publishes one blended catalogue figure; the assessment is the house model.
 * Where they disagree, the assessment wins, and the note below says why they differ.
 */
export function OfficialPovCard({
  setNumber,
  enabled,
  condition,
  assessment,
}: OfficialPovCardProps) {
  const { toast } = useToast();
  const { data, isLoading } = useOfficialPov(setNumber, condition, enabled);

  const refresh = useRefreshOfficialPov(setNumber, condition, {
    onUnavailable: (note) => toast({ title: 'Live fetch unavailable here', description: note }),
    onScraped: () =>
      toast({ title: 'Part Out Value refreshed', description: 'Scraped fresh from BrickLink.' }),
    onError: (description) =>
      toast({ title: 'Refresh failed', description, variant: 'destructive' }),
  });

  if (!enabled || !setNumber) return null;

  const row = data?.found ? data.row : undefined;
  const ccy = row?.native_currency ?? 'GBP';
  const mult = n(row?.partout_multiple);
  // CMF "Complete Series of N" / "Box of N" listings divide a multi-item sold value by a single-pack
  // RRP, so the multiple is inflated ~Nx and not comparable to single-set multiples. Don't badge it
  // green as a "deal", and say why.
  const isAggregate = row?.is_aggregate_listing === true;

  return (
    <Card data-testid="official-pov-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Cross-check: BrickLink&apos;s own Part Out Value
              {data?.found && (
                <Badge variant={data.isFresh ? 'default' : 'secondary'} className="font-normal">
                  {data.ageMs != null ? `fetched ${fmtAge(data.ageMs)} ago` : 'cached'}
                  {data.isFresh === false ? ' · stale' : ''}
                </Badge>
              )}
            </CardTitle>
            <p className="pt-1 text-xs text-muted-foreground">
              BrickLink&apos;s published catalogue figure for{' '}
              {condition === 'new' ? 'new' : 'used'} parts. The assessment above is the decision.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refresh.isPending ? 'animate-spin' : ''}`} />
            {data?.found ? 'Refresh' : 'Fetch'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
        ) : !data?.found ? (
          <div className="text-sm text-muted-foreground py-2">
            Not yet scraped for this set/condition. Click <span className="font-medium">Fetch</span> to pull
            BrickLink&apos;s Part Out Value (live fetch runs on the local dev server). The assessment
            above does not depend on it.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Sold avg (6mo)</div>
                <div className="text-xl font-semibold">{money(row?.sold_6mo_native, ccy)}</div>
                <div className="text-xs text-muted-foreground">
                  {row?.sold_6mo_items ?? '?'} items · {row?.sold_6mo_lots ?? '?'} lots
                  {ccy !== 'GBP' && n(row?.sold_6mo_avg_gbp) != null ? ` · ≈ ${gbp(row?.sold_6mo_avg_gbp)}` : ''}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">For-sale avg</div>
                <div className="text-xl font-semibold">{money(row?.for_sale_native, ccy)}</div>
                <div className="text-xs text-muted-foreground">current listings</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">UK RRP</div>
                <div className="text-xl font-semibold">{gbp(row?.uk_retail_gbp)}</div>
                <div className="text-xs text-muted-foreground">Brickset</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Part Out
                </div>
                <div
                  className={`text-xl font-bold ${
                    isAggregate
                      ? 'text-muted-foreground'
                      : mult != null && mult >= 2
                        ? 'text-green-600'
                        : mult != null && mult >= 1.5
                          ? 'text-amber-600'
                          : ''
                  }`}
                >
                  {mult != null ? `${mult.toFixed(2)}×` : '—'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {isAggregate ? 'series aggregate — vs single-pack RRP, not comparable' : 'sold ÷ RRP'}
                </div>
              </div>
            </div>
            <Reconciliation row={row} assessment={assessment} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
