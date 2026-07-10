/**
 * Store-assessment detail — "trading-desk ledger" rendering of a persisted
 * StoreAssessment (server component, zero client JS). Decision-first layout:
 * verdict masthead with the five grade signals, then the money (raid card +
 * buy list), then fast movers/magnets, run history, and demoted diagnostics.
 */
import type { StoreAssessment, ScoredLot, Bucket } from '@/lib/bl-store-assessment/types';
import {
  SA, Fig, Kicker, VerdictChip, SignalBars, ShareMeter, Tile, OverlapTag, fmtGbp, fmtPct,
} from './primitives';

export interface RunHistoryEntry {
  scannedAt: string;
  mode: string;
  grade: number | null;
  verdict: string | null;
  buyableLots: number | null;
  buyableNetGbp: number | null;
  buyableFreshLots: number | null;
  medianAskVsMarket: number | null;
}

const numf = (n: number | null | undefined, dp = 2) => (n == null ? '—' : Number(n).toFixed(dp));

/**
 * Engine reasons carry raw precision (£79.39, 42.66%) that fights the tiles'
 * rounding 30px below. Tidy at render time — the engine text is shared with the
 * CLI report and stays untouched.
 */
function tidyReason(r: string): string {
  return r
    .replace(/£(\d+)\.(\d{2})/g, (_, i, f) => `£${Math.round(Number(`${i}.${f}`))}`)
    .replace(/(\d+)\.(\d{1,2})%/g, (_, i, f) => `${Number(`${i}.${f}`).toFixed(1)}%`);
}

function lotName(s: ScoredLot) {
  return `${s.itemNo}${s.colourName ? ` · ${s.colourName}` : ''}`;
}

/** Benchmark with provenance: † = worldwide fallback (+UK calibration applied). */
function Bench({ s }: { s: ScoredLot }) {
  return (
    <span title={s.priceSource === 'world' ? 'Worldwide 6-mo avg, +11% UK calibration' : 'UK 6-mo sold avg'}>
      {fmtGbp(s.benchmarkAvg)}
      {/* fixed-width marker slot keeps tabular digits aligned across UK/world rows */}
      <span className="inline-block w-[1ch] text-left align-super text-[10px] text-muted-foreground">
        {s.priceSource === 'world' ? '†' : ''}
      </span>
    </span>
  );
}

/** Thin-bar distribution rows (pricing positions, ageing buckets). */
function BucketBars({ buckets, colourFor }: { buckets: Bucket[]; colourFor?: (key: string) => string }) {
  return (
    <div className="grid gap-1.5">
      {buckets.map((b) => (
        <div key={b.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{b.key}</span>
          <span className="relative inline-block h-[5px] overflow-hidden rounded-sm bg-muted">
            <span
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{ width: `${Math.round(b.valueShare * 100)}%`, background: colourFor?.(b.key) ?? 'hsl(var(--foreground) / 0.6)' }}
            />
          </span>
          <Fig className="whitespace-nowrap text-muted-foreground">
            {fmtPct(b.valueShare)}<span className="hidden sm:inline"> · {b.lots} lots · {fmtGbp(b.value)}</span>
          </Fig>
        </div>
      ))}
    </div>
  );
}

const POSITION_COLOUR: Record<string, string> = {
  UNDER: SA.good, KEEN: SA.good, 'AT-MARKET': 'hsl(var(--foreground) / 0.5)',
  PREMIUM: SA.warn, OVER: SA.bad,
};

function thStyle(align: 'l' | 'r' = 'l') {
  return `py-1.5 ${align === 'r' ? 'text-right' : 'text-left'} text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground`;
}

function LotTable({ rows, kind }: { rows: ScoredLot[]; kind: 'margin' | 'str' | 'magnet' }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">None.</p>;
  const showOverlap = rows.some((s) => s.overlap != null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={`${thStyle()} sticky left-0 z-10 bg-background`}>Item</th>
            <th className={`${thStyle('r')} pl-3`}>Ask</th>
            {kind === 'margin' && (
              <>
                <th className={`${thStyle('r')} hidden pl-3 md:table-cell`} title="6-month sold average († = worldwide, +11% UK calibration)">6MA</th>
                <th className={`${thStyle('r')} hidden pl-3 md:table-cell`}>List</th>
                <th className={`${thStyle('r')} pl-3`}>Net/u</th>
                <th className={`${thStyle('r')} pl-3`}>Margin</th>
                <th className={`${thStyle('r')} pl-3`}>Qty</th>
                {showOverlap && <th className={`${thStyle()} pl-4`} title="vs OUR stock: NEW / R-OUT / R-THIN / DUP">Overlap</th>}
              </>
            )}
            {kind === 'str' && (
              <>
                <th className={`${thStyle('r')} pl-3`}>STR</th>
                <th className={`${thStyle('r')} pl-3`}>6MA</th>
                <th className={`${thStyle()} pl-4`}>Buy?</th>
              </>
            )}
            {kind === 'magnet' && (
              <>
                <th className={`${thStyle('r')} pl-3`} title="Worldwide sellers holding this (item, colour, condition)">Supply</th>
                <th className={`${thStyle('r')} pl-3`}>STR</th>
                <th className={`${thStyle()} pl-4`}>Buy?</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.invID} className="border-b border-border/50 hover:bg-muted/40">
              <td className="sticky left-0 z-10 max-w-[13rem] border-r border-border/50 bg-background py-1.5 md:max-w-[20rem]">
                <div className="truncate font-medium">{lotName(s)}</div>
                <div className="truncate text-[11px] text-muted-foreground">{s.condition === 'N' ? 'New' : 'Used'} · {s.itemName}</div>
              </td>
              <td className="py-1.5 pl-3 text-right"><Fig>{fmtGbp(s.ask)}</Fig></td>
              {kind === 'margin' && (
                <>
                  <td className="hidden py-1.5 pl-3 text-right md:table-cell"><Fig><Bench s={s} /></Fig></td>
                  <td className="hidden py-1.5 pl-3 text-right md:table-cell"><Fig>{fmtGbp(s.ourList)}</Fig></td>
                  <td className="py-1.5 pl-3 text-right"><Fig className="font-medium">{fmtGbp(s.netPerUnit)}</Fig></td>
                  <td className="py-1.5 pl-3 text-right"><Fig>{fmtPct(s.marginPct)}</Fig></td>
                  <td className="py-1.5 pl-3 text-right"><Fig>{s.invQty}</Fig></td>
                  {showOverlap && <td className="py-1.5 pl-4"><OverlapTag s={s} /></td>}
                </>
              )}
              {kind === 'str' && (
                <>
                  <td className="py-1.5 pl-3 text-right"><Fig>{numf(s.strLots)}</Fig></td>
                  <td className="py-1.5 pl-3 text-right"><Fig><Bench s={s} /></Fig></td>
                  <td className="py-1.5 pl-4">{s.withinMargin && <span className="text-xs font-semibold" style={{ color: SA.goodText }}>BUY</span>}</td>
                </>
              )}
              {kind === 'magnet' && (
                <>
                  <td className="py-1.5 pl-3 text-right"><Fig>{s.worldSupplyLots ?? '—'}</Fig></td>
                  <td className="py-1.5 pl-3 text-right"><Fig>{numf(s.strLots)}</Fig></td>
                  <td className="py-1.5 pl-4">{s.withinMargin && <span className="text-xs font-semibold" style={{ color: SA.goodText }}>BUY</span>}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((r) => r.priceSource === 'world') && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">† worldwide 6-mo avg, +11% UK calibration (no UK sold data for that lot)</p>
      )}
    </div>
  );
}

export function AssessmentDetail({ a, history = [] }: { a: StoreAssessment; history?: RunHistoryEntry[] }) {
  const verdictColour = a.verdict.label === 'BUY' ? SA.good : a.verdict.label === 'REVIEW' ? SA.warn : 'hsl(var(--border))';
  const fresh = a.overlap.available
    ? a.overlap.buyableTags.filter((t) => t.tag === 'NEW' || t.tag === 'RESTOCK_OUT')
    : [];
  const freshLots = fresh.reduce((n, t) => n + t.lots, 0);
  const newTag = a.overlap.buyableTags.find((t) => t.tag === 'NEW');
  const routTag = a.overlap.buyableTags.find((t) => t.tag === 'RESTOCK_OUT');

  return (
    <div className="space-y-8">
      {/* ── Masthead ─────────────────────────────────────────────── */}
      <section className="border-l-4 bg-muted/30 p-5" style={{ borderColor: verdictColour }}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="break-words font-[family-name:var(--font-sa-display)] text-3xl font-bold uppercase leading-none tracking-[0.02em] sm:text-4xl">
              {a.store.storeName ?? a.store.slug}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <a
                href={`https://store.bricklink.com/${encodeURIComponent(a.store.slug)}#/shop`}
                target="_blank" rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                store.bricklink.com/{a.store.slug} ↗
              </a>
              {' '}· {a.store.country ?? '?'} · scanned {a.scannedAt.slice(0, 16).replace('T', ' ')} · {a.mode} · engine v{a.engineVersion}
            </p>
            {a.scanTruncated && (
              <p className="mt-2 inline-block border px-2 py-1 text-xs font-semibold uppercase tracking-wide" style={{ borderColor: SA.warn, color: SA.warnText }}>
                ⚠ Scan truncated — totals understate this store
              </p>
            )}
            <ul className="mt-4 max-w-xl space-y-1 text-sm text-muted-foreground">
              {a.verdict.reasons.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="text-foreground/30">—</span><span>{tidyReason(r)}</span></li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <div className="flex items-baseline gap-3">
              <span className="font-[family-name:var(--font-sa-display)] text-7xl font-bold leading-none tabular-nums" style={{ color: a.verdict.label === 'SKIP' ? undefined : verdictColour }}>
                {a.verdict.grade.toFixed(0)}
              </span>
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
            <VerdictChip label={a.verdict.label} size="lg" />
            <div className="w-64">
              <SignalBars signals={a.verdict.signals} />
            </div>
          </div>
        </div>
      </section>

      {/* ── 01 · The money ───────────────────────────────────────── */}
      <section className="space-y-4">
        <Kicker n="01">The money</Kicker>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-5">
          <Tile label="Buyable lots" value={a.withinMargin.lots.toLocaleString()} sub={`of ${a.size.totalLots.toLocaleString()} in store`} />
          <Tile label="Outlay → Net" value={<>{fmtGbp(a.withinMargin.outlay, 0)} <span className="text-muted-foreground">→</span> <span style={{ color: a.withinMargin.projectedNet > 0 ? SA.goodText : undefined }}>{fmtGbp(a.withinMargin.projectedNet, 0)}</span></>} sub="projected after fees" />
          <Tile label="ROI" value={a.withinMargin.roiPct != null ? `${a.withinMargin.roiPct.toFixed(0)}%` : '—'} sub={a.withinMargin.blendedMarginPct != null ? `${a.withinMargin.blendedMarginPct.toFixed(1)}% blended margin` : undefined} />
          <Tile
            label="Fresh demand"
            value={a.overlap.available ? freshLots.toLocaleString() : '—'}
            accent={freshLots > 0 ? SA.good : undefined}
            sub={a.overlap.available ? `${newTag?.lots ?? 0} new · ${routTag?.lots ?? 0} restock` : 'no overlap data this run'}
          />
          <Tile label="Magnets" value={a.magnets.lots.toLocaleString()} sub={`${a.magnets.alsoWithinMargin} also buyable`} />
        </div>
        {a.overlap.available && a.overlap.freshNetShare != null && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Fresh demand share of buyable net</span>
            <ShareMeter share={a.overlap.freshNetShare} width="w-40" />
            <span className="text-xs">
              snapshot {a.overlap.snapshotAt ? a.overlap.snapshotAt.slice(0, 10) : '?'} · sales window {a.overlap.salesWindowDays ?? '—'}d
            </span>
          </div>
        )}
      </section>

      {/* ── 02 · Buy list ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Kicker n="02">Buy list — top lots within margin</Kicker>
          <span className="text-xs text-muted-foreground">
            ≥{fmtPct(a.inputs.minMargin)} net margin · inbound {fmtGbp(a.inputs.inboundPerUnit)}{a.inputs.inboundPerUnit === 0 ? ' (ex-postage)' : ''}/unit
          </span>
        </div>
        <LotTable rows={a.withinMargin.top} kind="margin" />
        {a.withinMargin.lots > a.withinMargin.top.length && (
          <p className="text-xs text-muted-foreground">
            Top {a.withinMargin.top.length} of {a.withinMargin.lots} buyable lots shown — run <Fig>/bl-basket {a.store.slug}</Fig> for the full cart.
          </p>
        )}
      </section>

      {/* ── 03/04 · Fast movers & magnets ─────────────────────────── */}
      <section className="grid gap-8 xl:grid-cols-2">
        <div className="space-y-3">
          <Kicker n="03">Fast movers</Kicker>
          <p className="text-xs text-muted-foreground">STR ≥ {a.inputs.minStr} (lots basis) · {a.highStr.lots} lots · {fmtGbp(a.highStr.value)} · {a.highStr.alsoWithinMargin} also buyable</p>
          <LotTable rows={a.highStr.top.slice(0, 8)} kind="str" />
        </div>
        <div className="space-y-3">
          <Kicker n="04">Magnets — scarce + selling</Kicker>
          <p className="text-xs text-muted-foreground">≤{a.inputs.magnetMaxSupplyLots} sellers worldwide + STR ≥ {a.inputs.minStr} · {a.magnets.lots} lots · {fmtGbp(a.magnets.value)}</p>
          <LotTable rows={a.magnets.top.slice(0, 8)} kind="magnet" />
        </div>
      </section>

      {/* ── 05 · Run history ──────────────────────────────────────── */}
      {history.length > 1 && (
        <section className="space-y-3">
          <Kicker n="05">Run history</Kicker>
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={thStyle()}>Scanned</th>
                  <th className={thStyle()}>Mode</th>
                  <th className={`${thStyle('r')} pl-3`}>Grade</th>
                  <th className={`${thStyle()} pl-4`}>Verdict</th>
                  <th className={`${thStyle('r')} pl-3`}>Buyable</th>
                  <th className={`${thStyle('r')} pl-3`}>Fresh</th>
                  <th className={`${thStyle('r')} pl-3`}>Net</th>
                  <th className={`${thStyle('r')} pl-3`}>Vs mkt</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.scannedAt} className="border-b border-border/50">
                    <td className="py-1.5"><Fig className="text-xs">{h.scannedAt.slice(0, 10)}</Fig></td>
                    <td className="py-1.5 text-xs text-muted-foreground">{h.mode}</td>
                    <td className="py-1.5 pl-3 text-right"><Fig>{h.grade?.toFixed(0) ?? '—'}</Fig></td>
                    <td className="py-1.5 pl-4">{h.verdict ? <VerdictChip label={h.verdict} /> : '—'}</td>
                    <td className="py-1.5 pl-3 text-right"><Fig>{h.buyableLots ?? '—'}</Fig></td>
                    <td className="py-1.5 pl-3 text-right"><Fig>{h.buyableFreshLots ?? '—'}</Fig></td>
                    <td className="py-1.5 pl-3 text-right"><Fig>{fmtGbp(h.buyableNetGbp, 0)}</Fig></td>
                    <td className="py-1.5 pl-3 text-right"><Fig>{h.medianAskVsMarket != null ? `${Math.round(h.medianAskVsMarket * 100)}%` : '—'}</Fig></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 06 · Diagnostics ──────────────────────────────────────── */}
      <section className="space-y-4">
        <Kicker n="06">Diagnostics</Kicker>
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Pricing — {a.pricing.label}
              {a.pricing.weightedMedianAskVsMarket != null && (
                <span className="ml-2 font-normal normal-case text-muted-foreground">wtd median {Math.round(a.pricing.weightedMedianAskVsMarket * 100)}% of market</span>
              )}
            </h3>
            <BucketBars buckets={a.pricing.positions} colourFor={(k) => POSITION_COLOUR[k] ?? 'hsl(var(--foreground) / 0.6)'} />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Ageing {a.ageing.motivatedSeller && <span className="ml-1" style={{ color: SA.warnText }}>· motivated seller</span>}
            </h3>
            <BucketBars buckets={a.ageing.buckets} colourFor={(k) => (k.startsWith('overstock') || k.startsWith('dead') ? SA.warn : k.startsWith('no benchmark') ? 'hsl(var(--muted-foreground) / 0.4)' : 'hsl(var(--foreground) / 0.6)')} />
            <p className="text-[11px] text-muted-foreground">signal over the {fmtPct(a.ageing.benchmarkedValueShare)} of value with a benchmark</p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">Benchmark confidence</h3>
            <div className="grid gap-1.5 text-xs">
              {[
                { label: 'UK price data', v: a.confidence.ukValueShare, c: SA.good },
                { label: 'World +11% calibration', v: a.confidence.worldValueShare, c: SA.info },
                { label: 'No benchmark', v: a.confidence.noneValueShare, c: 'hsl(var(--muted-foreground) / 0.4)' },
              ].map((r) => (
                <div key={r.label} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-2">
                  <span className="truncate text-muted-foreground">{r.label}</span>
                  <span className="relative inline-block h-[5px] overflow-hidden rounded-sm bg-muted">
                    <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.round(r.v * 100)}%`, background: r.c }} />
                  </span>
                  <Fig className="text-right text-muted-foreground">{fmtPct(r.v)}</Fig>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">Part mix</h3>
            <table className="w-full text-xs">
              <tbody>
                {a.partMix.matrix.map((c) => (
                  <tr key={`${c.itemType}${c.condition}`} className="border-b border-border/40">
                    <td className="py-1 text-muted-foreground">{c.itemType === 'P' ? 'Parts' : c.itemType === 'S' ? 'Sets' : 'Minifigs'} {c.condition === 'N' ? 'New' : 'Used'}</td>
                    <td className="py-1 text-right"><Fig>{c.lots.toLocaleString()} lots</Fig></td>
                    <td className="py-1 text-right"><Fig>{fmtGbp(c.value, 0)}</Fig></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground">
              new/used {fmtPct(a.partMix.newValueShare)}/{fmtPct(a.partMix.usedValueShare)} by value · damage notes {fmtPct(a.partMix.damageNoteShare, 1)} of used lots
              {(a.partMix.setCompleteness.complete + a.partMix.setCompleteness.incomplete + a.partMix.setCompleteness.sealed) > 0 &&
                ` · sets ${a.partMix.setCompleteness.complete}✓ ${a.partMix.setCompleteness.incomplete}✗ ${a.partMix.setCompleteness.sealed} sealed`}
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">Store shape</h3>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>Lots · pieces</span><Fig>{a.size.totalLots.toLocaleString()} · {a.size.totalPieces.toLocaleString()}</Fig></div>
              <div className="flex justify-between"><span>Store value</span><Fig>{fmtGbp(a.size.totalValue, 0)}</Fig></div>
              <div className="flex justify-between"><span>Median ask</span><Fig>{fmtGbp(a.size.medianLotPrice)}</Fig></div>
              <div className="flex justify-between"><span>Top-10 lots share</span><Fig>{fmtPct(a.concentration.top10ValueShare)}</Fig></div>
              <div className="flex justify-between"><span>Distinct items</span><Fig>{a.concentration.distinctItems.toLocaleString()}</Fig></div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">Seller</h3>
            {a.feedback ? (
              <div className="grid gap-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Feedback</span><Fig>{a.feedback.feedbackScore?.toLocaleString() ?? '—'}{a.feedback.positivePct != null ? ` · ${a.feedback.positivePct}% +` : ''}</Fig></div>
                <div className="flex justify-between"><span>Order rate</span><Fig>{a.feedback.ordersPerMonth != null ? `≈${a.feedback.ordersPerMonth}/mo` : '—'}</Fig></div>
                <div className="flex justify-between"><span>Member since</span><Fig>{a.feedback.memberSince ?? '—'}</Fig></div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Profile scrape unavailable.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
