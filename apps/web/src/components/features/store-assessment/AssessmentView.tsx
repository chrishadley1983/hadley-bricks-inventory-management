/**
 * Presentational rendering for a persisted StoreAssessment (server component — no
 * interactivity). Mirrors the terminal report's 10 sections as dashboard cards.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  StoreAssessment, ScoredLot, Bucket, Verdict,
} from '@/lib/bl-store-assessment/types';

const gbp = (n: number | null | undefined) => (n == null ? '—' : `£${Number(n).toFixed(2)}`);
const pct = (n: number | null | undefined, dp = 0) => (n == null ? '—' : `${(Number(n) * 100).toFixed(dp)}%`);
const numf = (n: number | null | undefined, dp = 2) => (n == null ? '—' : Number(n).toFixed(dp));

export function VerdictBadge({ label }: { label: Verdict['label'] }) {
  const variant = label === 'BUY' ? 'default' : label === 'REVIEW' ? 'secondary' : 'outline';
  return <Badge variant={variant} className={label === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-600' : label === 'SKIP' ? 'text-muted-foreground' : ''}>{label}</Badge>;
}

function Bar({ share, tone = 'primary' }: { share: number; tone?: 'primary' | 'warn' | 'good' }) {
  const cls = tone === 'warn' ? 'bg-amber-500' : tone === 'good' ? 'bg-emerald-500' : 'bg-primary';
  return (
    <div className="h-2 w-full rounded bg-muted">
      <div className={`h-2 rounded ${cls}`} style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function BucketList({ buckets, tone }: { buckets: Bucket[]; tone?: 'primary' | 'warn' | 'good' }) {
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <div key={b.key} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate">{b.key}</span>
          <Bar share={b.valueShare} tone={tone} />
          <span className="tabular-nums text-muted-foreground">{pct(b.valueShare)} · {b.lots} lots · {gbp(b.value)}</span>
        </div>
      ))}
    </div>
  );
}

function lotName(s: ScoredLot) {
  return `${s.itemNo}${s.colourName ? ` · ${s.colourName}` : ''}`;
}

function LotTable({ rows, kind }: { rows: ScoredLot[]; kind: 'margin' | 'str' | 'magnet' }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Ask</TableHead>
            {kind === 'margin' && <><TableHead className="text-right">6MA</TableHead><TableHead className="text-right">Our list</TableHead><TableHead className="text-right">Net/u</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Qty</TableHead></>}
            {kind === 'str' && <><TableHead className="text-right">STR</TableHead><TableHead className="text-right">6MA</TableHead><TableHead>Buy?</TableHead></>}
            {kind === 'magnet' && <><TableHead className="text-right">Supply</TableHead><TableHead className="text-right">STR</TableHead><TableHead>Buy?</TableHead></>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.invID}>
              <TableCell className="max-w-[22rem]">
                <div className="truncate font-medium">{lotName(s)}</div>
                <div className="truncate text-xs text-muted-foreground">{s.condition === 'N' ? 'New' : 'Used'} · {s.itemName}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{gbp(s.ask)}</TableCell>
              {kind === 'margin' && <>
                <TableCell className="text-right tabular-nums">{gbp(s.ukSoldAvg)}</TableCell>
                <TableCell className="text-right tabular-nums">{gbp(s.ourList)}</TableCell>
                <TableCell className="text-right tabular-nums">{gbp(s.netPerUnit)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(s.marginPct)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.invQty}</TableCell>
              </>}
              {kind === 'str' && <>
                <TableCell className="text-right tabular-nums">{numf(s.strLots, 2)}</TableCell>
                <TableCell className="text-right tabular-nums">{gbp(s.ukSoldAvg)}</TableCell>
                <TableCell>{s.withinMargin ? <Badge className="bg-emerald-600 hover:bg-emerald-600">BUY</Badge> : ''}</TableCell>
              </>}
              {kind === 'magnet' && <>
                <TableCell className="text-right tabular-nums">{s.worldSupplyLots ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{numf(s.strLots, 2)}</TableCell>
                <TableCell>{s.withinMargin ? <Badge className="bg-emerald-600 hover:bg-emerald-600">BUY</Badge> : ''}</TableCell>
              </>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function AssessmentDetail({ a }: { a: StoreAssessment }) {
  return (
    <div className="space-y-6">
      {/* Verdict */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-3">
              {a.store.storeName ?? a.store.slug}
              <VerdictBadge label={a.verdict.label} />
              <Badge variant="outline">{a.mode.toUpperCase()}</Badge>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{a.store.country ?? '?'} · ID {a.store.storeId ?? '?'} · scanned {a.scannedAt.slice(0, 16).replace('T', ' ')}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums">{a.verdict.grade}</div>
            <div className="text-xs text-muted-foreground">/ 100 attractiveness</div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="font-medium">{a.verdict.headline}</p>
          <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
            {a.verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </CardContent>
      </Card>

      {/* Size & value */}
      <Card>
        <CardHeader><CardTitle>1 · Store size &amp; value</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Lots" value={a.size.totalLots.toLocaleString()} />
            <Stat label="Pieces" value={a.size.totalPieces.toLocaleString()} />
            <Stat label="Store value" value={gbp(a.size.totalValue)} sub={`avg ${gbp(a.size.avgValuePerLot)}/lot`} />
            <Stat label="Median ask" value={gbp(a.size.medianLotPrice)} />
          </div>
          <BucketList buckets={a.size.byType} />
        </CardContent>
      </Card>

      {/* Pricing strategy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">2 · Pricing strategy <Badge variant="secondary">{a.pricing.label}</Badge></CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Weighted-median ask = <span className="font-semibold text-foreground">{a.pricing.weightedMedianAskVsUk != null ? `${Math.round(a.pricing.weightedMedianAskVsUk * 100)}% of 6-mo market avg` : '—'}</span> across {a.pricing.covered} benchmarked lots (UK where available; see Data confidence).
          </p>
          <BucketList buckets={a.pricing.positions} />
        </CardContent>
      </Card>

      {/* Feedback */}
      <Card>
        <CardHeader><CardTitle>3 · Feedback &amp; order rate</CardTitle></CardHeader>
        <CardContent>
          {a.feedback ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Feedback" value={a.feedback.feedbackScore?.toLocaleString() ?? '—'} />
              <Stat label="Positive" value={a.feedback.positivePct != null ? `${a.feedback.positivePct}%` : '—'} />
              <Stat label="Order rate" value={a.feedback.ordersPerMonth != null ? `${a.feedback.ordersPerMonth}/mo` : '—'} sub={a.feedback.feedbackLast6mo != null ? `${a.feedback.feedbackLast6mo} in 6mo` : undefined} />
              <Stat label="Member since" value={a.feedback.memberSince ?? '—'} />
            </div>
          ) : <p className="text-sm text-muted-foreground">Profile scrape unavailable.</p>}
        </CardContent>
      </Card>

      {/* Part mix */}
      <Card>
        <CardHeader><CardTitle>4 · Part mix (type × condition)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Condition</TableHead><TableHead className="text-right">Lots</TableHead><TableHead className="text-right">Pieces</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
              <TableBody>
                {a.partMix.matrix.map((c) => (
                  <TableRow key={`${c.itemType}${c.condition}`}>
                    <TableCell>{c.itemType === 'P' ? 'Parts' : c.itemType === 'S' ? 'Sets' : 'Minifigs'}</TableCell>
                    <TableCell>{c.condition === 'N' ? 'New' : 'Used'}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.lots.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.pieces.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{gbp(c.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground">
            New / Used by value: {pct(a.partMix.newValueShare)} / {pct(a.partMix.usedValueShare)} · used lots with damage note: {pct(a.partMix.damageNoteShare, 1)}
            {(a.partMix.setCompleteness.complete + a.partMix.setCompleteness.incomplete + a.partMix.setCompleteness.sealed + a.partMix.setCompleteness.unknown) > 0 &&
              ` · sets: ${a.partMix.setCompleteness.complete} complete, ${a.partMix.setCompleteness.incomplete} incomplete, ${a.partMix.setCompleteness.sealed} sealed`}
          </p>
        </CardContent>
      </Card>

      {/* Within margin */}
      <Card>
        <CardHeader><CardTitle>5 · Lots within pricing margin</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Buyable lots" value={a.withinMargin.lots.toLocaleString()} />
            <Stat label="Outlay" value={gbp(a.withinMargin.outlay)} />
            <Stat label="Projected net" value={gbp(a.withinMargin.projectedNet)} />
            <Stat label="Margin" value={a.withinMargin.blendedMarginPct != null ? `${a.withinMargin.blendedMarginPct}%` : '—'} />
            <Stat label="ROI" value={a.withinMargin.roiPct != null ? `${a.withinMargin.roiPct}%` : '—'} />
          </div>
          <LotTable rows={a.withinMargin.top} kind="margin" />
        </CardContent>
      </Card>

      {/* High STR */}
      <Card>
        <CardHeader><CardTitle>6 · High-STR lots</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{a.highStr.lots} lots · {gbp(a.highStr.value)} · {a.highStr.alsoWithinMargin} also within margin.</p>
          <LotTable rows={a.highStr.top} kind="str" />
        </CardContent>
      </Card>

      {/* Magnets */}
      <Card>
        <CardHeader><CardTitle>7 · Magnets <span className="text-sm font-normal text-muted-foreground">(scarce + selling)</span></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">≤{a.inputs.magnetMaxSupplyLots} sellers worldwide + STR ≥ {a.inputs.minStr}. {a.magnets.lots} lots · {gbp(a.magnets.value)} · {a.magnets.alsoWithinMargin} also within margin.</p>
          <LotTable rows={a.magnets.top} kind="magnet" />
        </CardContent>
      </Card>

      {/* Confidence / ageing / concentration */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>8 · Data confidence</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><span>UK price data</span><span className="tabular-nums">{pct(a.confidence.ukValueShare)}</span></div>
            <Bar share={a.confidence.ukValueShare} tone="good" />
            <div className="flex items-center justify-between"><span>World fallback</span><span className="tabular-nums">{pct(a.confidence.worldValueShare)}</span></div>
            <Bar share={a.confidence.worldValueShare} tone="warn" />
            <div className="flex items-center justify-between"><span>No benchmark</span><span className="tabular-nums">{pct(a.confidence.noneValueShare)}</span></div>
            <Bar share={a.confidence.noneValueShare} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>9 · Ageing {a.ageing.motivatedSeller && <Badge variant="secondary" className="ml-1">motivated</Badge>}</CardTitle></CardHeader>
          <CardContent><BucketList buckets={a.ageing.buckets} tone="warn" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>10 · Concentration</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span>Top-10 lots</span><span className="tabular-nums">{pct(a.concentration.top10ValueShare)} of value</span></div>
            <Bar share={a.concentration.top10ValueShare} />
            <p className="text-muted-foreground">{a.concentration.distinctItems.toLocaleString()} distinct items</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
