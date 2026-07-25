'use client';

import {
  TrendingUp,
  TrendingDown,
  MinusCircle,
  Magnet,
  Layers,
  Store,
  AlertTriangle,
  Wallet,
} from 'lucide-react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import type { PartoutAssessment, PartoutMagnet } from '@/types/partout';

/**
 * PartoutAssessmentPanel
 *
 * Renders the canonical part-out decision for one condition: the honesty ladder
 * (gross → realisable → net), the gate verdict, max buy, the STR band ladder,
 * magnets, where the value sits, and overlap against our own store.
 *
 * Every threshold shown here is echoed from the assessment itself (which sources
 * them from `lib/bricklink/fees`) — this component must never introduce a cutoff
 * of its own, or the screen stops reconciling with the store reports.
 */

const pct = (v: number | null | undefined, dp = 0): string =>
  v == null ? '—' : `${(v * 100).toFixed(dp)}%`;

const multiple = (v: number | null): string => (v == null ? '—' : `${v.toFixed(2)}×`);

function VerdictCard({ assessment }: { assessment: PartoutAssessment }) {
  const { verdict, verdictReason, povMultiple, gapGbp, gate, maxBuy } = assessment;

  const style =
    verdict === 'PART-OUT'
      ? { card: 'border-green-200 bg-green-50', text: 'text-green-700', Icon: TrendingUp }
      : verdict === 'PART-OUT-BELOW'
        ? { card: 'border-amber-200 bg-amber-50', text: 'text-amber-800', Icon: Wallet }
        : verdict === 'SELL-COMPLETE' || verdict === 'NOT-VIABLE'
          ? { card: 'border-red-200 bg-red-50', text: 'text-red-700', Icon: TrendingDown }
          : { card: 'border-muted bg-muted/40', text: 'text-muted-foreground', Icon: MinusCircle };

  const label =
    verdict === 'PART-OUT'
      ? 'Part Out'
      : verdict === 'PART-OUT-BELOW'
        ? // The acquisition answer, which stands without a sell-complete comparison.
          `Part Out below ${maxBuy.price == null ? '—' : formatCurrency(maxBuy.price)}`
        : verdict === 'SELL-COMPLETE'
          ? 'Sell Complete'
          : verdict === 'NOT-VIABLE'
            ? 'Not Worth Parting Out'
            : 'No Parts Data';

  return (
    <Card className={style.card}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <style.Icon className={`h-6 w-6 shrink-0 ${style.text}`} />
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-muted-foreground">Assessment</div>
            <div className={`text-xl font-bold ${style.text}`} data-testid="partout-verdict">
              {label}
            </div>
            <p className="text-sm text-muted-foreground">{verdictReason}</p>
            {/*
              The gate row only means something when there IS a complete-set price. With
              no comparison to make, showing "— (gate 2.0×)" reads as a failure rather
              than an absence, so it's replaced by the answer we do have.
            */}
            {povMultiple == null && gapGbp == null ? (
              <div className="pt-1 text-xs text-muted-foreground">
                No sell-complete comparison available — this is the acquisition answer only.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                <span>
                  POV multiple <strong>{multiple(povMultiple)}</strong> (gate{' '}
                  {gate.povMultipleMin.toFixed(1)}×)
                </span>
                <span aria-hidden>·</span>
                <span>
                  Gap <strong>{gapGbp == null ? '—' : formatCurrency(gapGbp)}</strong> (gate{' '}
                  {formatCurrency(gate.minGapGbp)})
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The honesty ladder. Gross flatters — it assumes every lot clears at guide price —
 * so it never leads alone; net is the only figure that is money we'd actually see.
 */
function LadderCard({ assessment }: { assessment: PartoutAssessment }) {
  const { grossPov, realisablePov, netPov, captureRate, feePct } = assessment;

  const rungs = [
    {
      label: 'Gross POV',
      value: grossPov,
      note: 'Σ qty × price — assumes everything sells',
      emphasis: false,
    },
    {
      label: 'Realisable',
      value: realisablePov,
      note: `after liquidity haircut · ${pct(captureRate)} capture`,
      emphasis: false,
    },
    {
      label: 'Net',
      value: netPov,
      note: `after ${pct(feePct, 1)} fees — what we'd actually see`,
      emphasis: true,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Part-Out Value</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rungs.map((rung) => (
          <div key={rung.label} className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div
                className={`text-sm ${rung.emphasis ? 'font-semibold' : 'font-medium text-muted-foreground'}`}
              >
                {rung.label}
              </div>
              <div className="text-xs text-muted-foreground">{rung.note}</div>
            </div>
            <div
              className={
                rung.emphasis ? 'text-2xl font-bold shrink-0' : 'text-lg font-semibold shrink-0'
              }
              data-testid={`pov-ladder-${rung.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {formatCurrency(rung.value)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MaxBuyCard({ assessment }: { assessment: PartoutAssessment }) {
  const { maxBuy, setPrice } = assessment;

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <Wallet className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-muted-foreground">
              Max buy @ {pct(maxBuy.targetMargin)} margin
            </div>
            <div
              className={`text-2xl font-bold ${
                maxBuy.price != null && maxBuy.price <= 0 ? 'text-red-700' : ''
              }`}
              data-testid="partout-max-buy"
            >
              {maxBuy.price == null ? '—' : formatCurrency(maxBuy.price)}
            </div>
            {/*
              Postage is shown as its own line rather than folded in silently — on a thin
              set it is the whole story (7643 used: £2.54 ceiling, £3.00 postage).
            */}
            <div className="text-xs text-muted-foreground">
              {maxBuy.beforePostage == null
                ? 'From realisable POV, net of fees.'
                : `${formatCurrency(maxBuy.beforePostage)} from realisable POV net of fees, less ${formatCurrency(maxBuy.postageGbp)} inbound postage.`}
            </div>
            {maxBuy.price != null && maxBuy.price <= 0 && (
              <div className="pt-1 text-xs font-medium text-red-700">
                {maxBuy.price < 0 ? 'Negative' : 'Zero'} — no purchase price makes this work.
              </div>
            )}
            <div className="pt-1 text-xs text-muted-foreground">
              Teardown time isn&apos;t a separate cost here — it&apos;s already priced into the{' '}
              {pct(maxBuy.targetMargin)} margin and the part-out gate.
            </div>
            {setPrice != null && maxBuy.price != null && (
              <div className="pt-1 text-xs text-muted-foreground">
                Set currently {formatCurrency(setPrice)} —{' '}
                {maxBuy.price >= setPrice ? (
                  <span className="font-medium text-green-700">within budget</span>
                ) : (
                  <span className="font-medium text-red-700">
                    {formatCurrency(setPrice - maxBuy.price)} over
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** STR band ladder — inclusive gates, so each row is "lots at STR ≥ gate". */
function StrBandsCard({ assessment }: { assessment: PartoutAssessment }) {
  const { strBands, pricedLots } = assessment;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Sell-through depth
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="pb-3 text-xs text-muted-foreground">
          Inclusive gates on quantity-basis STR. Each row is the lots at or above that sell-through,
          and what they are worth.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">STR ≥</th>
                <th className="pb-2 pr-3 text-right font-medium">Lots</th>
                <th className="pb-2 pr-3 text-right font-medium">Pieces</th>
                <th className="pb-2 pr-3 text-right font-medium">Gross</th>
                <th className="pb-2 pr-3 text-right font-medium">Realisable</th>
                <th className="pb-2 text-right font-medium">% of POV</th>
              </tr>
            </thead>
            <tbody>
              {strBands.map((band) => (
                <tr key={band.gate} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{band.gate.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {band.lots}
                    {band.gate === 0 && pricedLots > 0 && (
                      <span className="text-muted-foreground"> / {pricedLots}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{band.qty}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatCurrency(band.grossValue)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatCurrency(band.realisableValue)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{pct(band.shareOfPov)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function MagnetRow({ magnet }: { magnet: PartoutMagnet }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded bg-muted">
            <Image
              src={magnet.imageUrl}
              alt={magnet.name}
              fill
              sizes="32px"
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{magnet.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {magnet.partNumber} · {magnet.colourName}
            </div>
          </div>
        </div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{magnet.quantity}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{magnet.worldSupplyLots}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {magnet.str == null ? '—' : magnet.str.toFixed(2)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(magnet.lineValue)}</td>
      <td className="py-2 text-right">
        {magnet.overlap ? (
          <Badge variant="outline" className="text-xs">
            {magnet.overlap.replace('RESTOCK_', 'R-')}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Magnets are surfaced independently of the verdict — a set can fail the part-out
 * gate and still be worth buying for the traffic these pull to the store.
 */
function MagnetsCard({ assessment }: { assessment: PartoutAssessment }) {
  const { magnets, verdict, magnetCoverage } = assessment;

  // "No magnets" is only an honest claim if we could actually run the test. The supply
  // read is non-fatal, so an outage or a cache gap otherwise renders as a confident
  // absence. Distinguish no-evidence from no-magnets.
  const noSupplyData = magnetCoverage.total > 0 && magnetCoverage.withSupplyData === 0;
  const partialSupply =
    !noSupplyData && magnetCoverage.withSupplyData < magnetCoverage.total;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Magnet className="h-4 w-4" />
          Magnets
          {magnets.length > 0 && (
            <Badge variant="secondary" data-testid="magnet-count">
              {magnets.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {noSupplyData ? (
          <p className="text-sm text-muted-foreground">
            Worldwide supply data is unavailable for every lot in this set, so the magnet test
            couldn&apos;t be applied. This is <strong>not</strong> a finding of &ldquo;no
            magnets&rdquo; — nothing is claimed either way.
          </p>
        ) : magnets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No magnet lots in this set — nothing clears both the scarcity and sell-through tests.
            {partialSupply && (
              <>
                {' '}
                Checked against {magnetCoverage.withSupplyData} of {magnetCoverage.total} lots;
                the rest have no supply data.
              </>
            )}
          </p>
        ) : (
          <>
            <p className="pb-3 text-xs text-muted-foreground">
              Very low worldwide supply with decent sell-through — these draw buyers to the store
              {verdict !== 'PART-OUT' && ', and stand independently of the verdict above'}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Part</th>
                    <th className="pb-2 pr-3 text-right font-medium">Qty</th>
                    <th className="pb-2 pr-3 text-right font-medium">World lots</th>
                    <th className="pb-2 pr-3 text-right font-medium">STR</th>
                    <th className="pb-2 pr-3 text-right font-medium">Value</th>
                    <th className="pb-2 text-right font-medium">Overlap</th>
                  </tr>
                </thead>
                <tbody>
                  {magnets.map((m) => (
                    <MagnetRow key={`${m.partNumber}:${m.colourId}`} magnet={m} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConcentrationCard({ assessment }: { assessment: PartoutAssessment }) {
  const { concentration, grossPov } = assessment;
  const { topLots, top10Share, lotsToHalfPov, byType } = concentration;

  const types = [
    { label: 'Minifigs', value: byType.minifig },
    { label: 'Parts', value: byType.part },
    { label: 'Other', value: byType.other },
  ].filter((t) => t.value > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Where the value sits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Top 10 lots</div>
            <div className="text-xl font-bold" data-testid="top10-share">
              {pct(top10Share)}
            </div>
            <div className="text-xs text-muted-foreground">of gross POV</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Half the value in</div>
            <div className="text-xl font-bold">{lotsToHalfPov}</div>
            <div className="text-xs text-muted-foreground">lots</div>
          </div>
        </div>

        {types.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <Badge key={t.label} variant="outline">
                {t.label} {formatCurrency(t.value)} ({pct(grossPov > 0 ? t.value / grossPov : 0)})
              </Badge>
            ))}
          </div>
        )}

        {topLots.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Lot</th>
                  <th className="pb-2 pr-3 text-right font-medium">Qty</th>
                  <th className="pb-2 pr-3 text-right font-medium">Value</th>
                  <th className="pb-2 text-right font-medium">% of POV</th>
                </tr>
              </thead>
              <tbody>
                {topLots.map((lot) => (
                  <tr
                    key={`${lot.partNumber}:${lot.colourName}`}
                    className="border-b last:border-0"
                  >
                    <td className="py-2 pr-3">
                      <div className="truncate font-medium">{lot.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {lot.partNumber} · {lot.colourName}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{lot.quantity}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(lot.lineValue)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{pct(lot.shareOfPov, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OverlapCard({ assessment }: { assessment: PartoutAssessment }) {
  const { overlap } = assessment;

  if (!overlap) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-4 w-4" />
            Store overlap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No Bricqer stock snapshot available, so overlap can&apos;t be assessed. Nothing here is
            claimed either way.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { counts, additionalValue, duplicateValue, snapshotAt, salesWindowDays } = overlap;
  const tags = [
    { key: 'NEW', label: 'New to store', value: counts.NEW },
    { key: 'RESTOCK_OUT', label: 'Restock (out)', value: counts.RESTOCK_OUT },
    { key: 'RESTOCK_THIN', label: 'Restock (thin)', value: counts.RESTOCK_THIN },
    { key: 'DUPLICATE', label: 'Already deep', value: counts.DUPLICATE },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="h-4 w-4" />
          Store overlap
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {tags.map((t) => (
            <div key={t.key}>
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="text-lg font-bold tabular-nums">{t.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 border-t pt-3">
          <div>
            <div className="text-xs text-muted-foreground">Additional to store</div>
            <div className="text-lg font-bold text-green-700">
              {formatCurrency(additionalValue)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Already held deep</div>
            <div className="text-lg font-bold text-muted-foreground">
              {formatCurrency(duplicateValue)}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {snapshotAt
            ? `Snapshot ${new Date(snapshotAt).toLocaleString('en-GB')}`
            : 'Snapshot date unknown'}{' '}
          · sales window {salesWindowDays} days
        </p>
      </CardContent>
    </Card>
  );
}

interface PartoutAssessmentPanelProps {
  assessment: PartoutAssessment;
}

export function PartoutAssessmentPanel({ assessment }: PartoutAssessmentPanelProps) {
  return (
    <div className="space-y-4" data-testid="partout-assessment">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <VerdictCard assessment={assessment} />
        <LadderCard assessment={assessment} />
        <MaxBuyCard assessment={assessment} />
      </div>

      {assessment.unpricedLots > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              <strong>{assessment.unpricedLots}</strong> of{' '}
              {assessment.pricedLots + assessment.unpricedLots} lots have no UK price data. They
              contribute £0, so every figure above understates this set.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StrBandsCard assessment={assessment} />
        <ConcentrationCard assessment={assessment} />
      </div>

      <MagnetsCard assessment={assessment} />
      <OverlapCard assessment={assessment} />
    </div>
  );
}
