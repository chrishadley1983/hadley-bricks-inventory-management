/**
 * Store-assessment detail — "trading-desk ledger" rendering of a persisted
 * StoreAssessment. Decision-first layout: verdict masthead with the five grade
 * signals, then the money (honesty ladder + buy list), fast movers/magnets, the
 * STR-gate ladder, the sets decision, run history, and demoted diagnostics.
 *
 * Server-rendered apart from the lot tables, which are client-side so they can sort
 * (see LotTable).
 */
import type {
  StoreAssessment,
  Bucket,
  SetsSection,
  StrGateColumn,
} from '@/lib/bl-store-assessment/types';
import { UK_MAGNET } from '@/lib/bricklink/fees';
import { LotTable } from './LotTable';
import { SetsTable } from './SetsTable';
import {
  SA,
  Fig,
  Kicker,
  VerdictChip,
  SignalBars,
  ShareMeter,
  Tile,
  fmtGbp,
  fmtPct,
} from './primitives';

/** Provenance for the stored wanted list — see the wanted_list_meta column comment. */
export interface WantedListMeta {
  min_str?: number;
  exclude_dups?: boolean;
  magnets_only?: boolean;
  entries?: number;
  lots?: number;
  outlay?: number;
  net?: number;
  skipped?: string[];
}

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
 * Does this run carry UK stock quantities — and therefore, was it scored on the UK magnet
 * gate?
 *
 * Magnets moved from "≤3 sellers worldwide" to UK stock QUANTITY (UK_MAGNET) on
 * 2026-07-26 10:01, and ENGINE_VERSION was not bumped — so the version cannot tell the two
 * apart. `ukStockQty` was added to ScoredLot by that same change, so its presence on any
 * persisted lot can: old rows have no such key, new rows have it (possibly null).
 *
 * It matters because the caption states a threshold and the table shows a Stock qty
 * column. Naming the UK gate over a run scored on worldwide seller lots is the same defect
 * as the caption this replaced — just pointing the other way.
 */
function hasUkStock(a: StoreAssessment): boolean {
  const lots = [...a.magnets.top, ...a.highStr.top, ...a.withinMargin.top, ...a.size.biggestLots];
  return lots.some((s) => 'ukStockQty' in s);
}

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

/** Thin-bar distribution rows (pricing positions, ageing buckets). */
function BucketBars({
  buckets,
  colourFor,
}: {
  buckets: Bucket[];
  colourFor?: (key: string) => string;
}) {
  return (
    <div className="grid gap-1.5">
      {buckets.map((b) => (
        <div key={b.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{b.key}</span>
          <span className="relative inline-block h-[5px] overflow-hidden rounded-sm bg-muted">
            <span
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{
                width: `${Math.round(b.valueShare * 100)}%`,
                background: colourFor?.(b.key) ?? 'hsl(var(--foreground) / 0.6)',
              }}
            />
          </span>
          <Fig className="whitespace-nowrap text-muted-foreground">
            {fmtPct(b.valueShare)}
            <span className="hidden sm:inline">
              {' '}
              · {b.lots} lots · {fmtGbp(b.value)}
            </span>
          </Fig>
        </div>
      ))}
    </div>
  );
}

const POSITION_COLOUR: Record<string, string> = {
  UNDER: SA.good,
  KEEN: SA.good,
  'AT-MARKET': 'hsl(var(--foreground) / 0.5)',
  PREMIUM: SA.warn,
  OVER: SA.bad,
};

function thStyle(align: 'l' | 'r' = 'l') {
  return `py-1.5 ${align === 'r' ? 'text-right' : 'text-left'} text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground`;
}

/**
 * The honesty ladder — raw → demand-capped → LIQUID.
 *
 * The headline is the LIQUID figure, not the raw one. Raw sums every buyable lot's net
 * as though all of it clears at our list price; on Blanco_Brix that read £1,151 while the
 * liquid basket was £17. Capping to six months of observed market demand, dropping lots we
 * already hold deep, and charging the buy the FULL standalone inbound postage is what
 * makes the number something you can act on.
 *
 * Pre-v7 runs have no `decision` block. They show the raw figure and say so, rather than
 * rendering a dash where the honest number belongs.
 */
function MoneyLadder({ a }: { a: StoreAssessment }) {
  const d = a.decision;

  if (!d) {
    return (
      <div className="border-l-2 py-1 pl-3" style={{ borderColor: SA.warn }}>
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Projected net · raw
        </div>
        <div className="font-[family-name:var(--font-sa-display)] text-4xl font-semibold leading-tight tabular-nums">
          {fmtGbp(a.withinMargin.projectedNet, 0)}
        </div>
        <div className="mt-1 text-xs" style={{ color: SA.warnText }}>
          Run predates the honesty ladder — this is the uncapped figure, which flatters. Re-run the
          store for the demand-capped and liquid numbers.
        </div>
      </div>
    );
  }

  const rungs = [
    { label: 'Raw', value: d.rawNet, note: 'every buyable lot, uncapped' },
    { label: 'Capped', value: d.cappedNet, note: 'limited to 6-mo market demand' },
  ];

  return (
    <div
      className="border-l-2 py-1 pl-3"
      style={{ borderColor: d.liquidNet > 0 ? SA.good : 'hsl(var(--border))' }}
    >
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        Liquid net · STR ≥ {d.liquidGate}
      </div>
      <div
        className="font-[family-name:var(--font-sa-display)] text-4xl font-semibold leading-tight tabular-nums"
        style={{ color: d.liquidNet > 0 ? SA.goodText : undefined }}
      >
        {fmtGbp(d.liquidNet, 0)}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {d.liquidLots.toLocaleString()} lots · {fmtGbp(d.liquidOutlay, 0)} outlay · DUPs excluded ·
        incl. {fmtGbp(d.inboundPostage)} standalone postage
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {rungs.map((r) => (
          <span key={r.label} className="whitespace-nowrap" title={r.note}>
            {r.label} <Fig className="text-foreground/70">{fmtGbp(r.value, 0)}</Fig>
            <span className="px-1 text-foreground/30">→</span>
          </span>
        ))}
        <span className="whitespace-nowrap font-medium">
          Liquid <Fig className="text-foreground">{fmtGbp(d.liquidNet, 0)}</Fig>
        </span>
      </div>
    </div>
  );
}

/**
 * Download link for the run's BrickLink wanted list.
 *
 * The figures come from `wanted_list_meta`, so the link states what is IN the file before
 * you open it — a download whose filter you can't see is a cart you can't trust. It also
 * says the list spans the whole store, because everything else in this section is a
 * top-N sample and the two are easily confused.
 *
 * Runs predating the export show the CLI command instead of a dead link.
 */
function WantedListLink({ slug, meta }: { slug: string; meta: WantedListMeta | null }) {
  if (!meta?.entries) {
    return (
      <p className="text-xs text-muted-foreground">
        No wanted list on this run — it predates the export, or nothing cleared the filter. Re-run:{' '}
        <Fig>npx tsx scripts/store-assessment.ts --store-slug={slug}</Fig>
      </p>
    );
  }
  const filters = [
    meta.min_str != null ? `STR ≥ ${meta.min_str}` : null,
    meta.exclude_dups ? 'no DUPs' : null,
    meta.magnets_only ? 'magnets only' : null,
  ].filter(Boolean);
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 py-1 pl-3 text-sm"
      style={{ borderColor: SA.info }}
    >
      <a
        href={`/api/arbitrage/store-assessment/${encodeURIComponent(slug)}/wanted-list`}
        className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ↓ Wanted list XML
      </a>
      <span className="text-xs text-muted-foreground">
        {meta.entries.toLocaleString()} entries from {(meta.lots ?? 0).toLocaleString()} lots
        {filters.length > 0 && ` · ${filters.join(' · ')}`}
        {meta.outlay != null && meta.net != null && (
          <>
            {' · '}
            {fmtGbp(meta.outlay, 0)} <span className="text-foreground/30">→</span>{' '}
            {fmtGbp(meta.net, 0)} net
          </>
        )}
        {' · whole store, not just the rows below'}
      </span>
      {meta.skipped && meta.skipped.length > 0 && (
        <span className="text-xs" style={{ color: SA.warnText }}>
          {meta.skipped.length} id(s) skipped as un-uploadable
        </span>
      )}
    </div>
  );
}

/**
 * The STR-gate ladder — cumulative "STR ≥ g", metrics as rows.
 *
 * Persisted since engine v5 and, until now, rendered only in the CLI report. It is the
 * answer to "how much of this is worth having": each rung drops the slower lots and shows
 * what survives, so the shape of the fall-off tells you whether the headline rests on a
 * handful of movers or on shelf-warmers.
 */
function GateLadder({ gates }: { gates: StrGateColumn[] }) {
  if (!gates.length) return null;
  const th = (align: 'l' | 'r' = 'r') =>
    `py-1.5 ${align === 'r' ? 'text-right' : 'text-left'} text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground`;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={th('l')} title="Inclusive gate on quantity-basis STR">
              STR ≥
            </th>
            <th className={`${th()} pl-3`}>Lots</th>
            <th className={`${th()} pl-3`}>Outlay</th>
            <th className={`${th()} pl-3`}>Net</th>
            <th className={`${th()} pl-3`}>Margin</th>
            <th className={`${th()} pl-3`}>ROI</th>
            <th
              className={`${th()} pl-3`}
              title="Median quantity-basis STR of the lots at this gate"
            >
              Med STR
            </th>
            <th
              className={`${th()} hidden pl-3 md:table-cell`}
              title="Median months of market supply this depth represents (≈ 6 ÷ STR)"
            >
              Med mo
            </th>
            <th
              className={`${th()} pl-3`}
              title="Lots additional to OUR store (NEW + restock-out) and their net"
            >
              Addl
            </th>
          </tr>
        </thead>
        <tbody>
          {gates.map((g) => (
            <tr key={g.gate} className="border-b border-border/50">
              <td className="py-1.5">
                <Fig className="font-medium">{g.gate.toFixed(2)}</Fig>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Fig>{g.lots.toLocaleString()}</Fig>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Fig>{fmtGbp(g.outlay, 0)}</Fig>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Fig className="font-medium">{fmtGbp(g.net, 0)}</Fig>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Fig>{g.marginPct == null ? '—' : `${(g.marginPct * 100).toFixed(0)}%`}</Fig>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Fig>{g.roiPct == null ? '—' : `${(g.roiPct * 100).toFixed(0)}%`}</Fig>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Fig>{numf(g.medianStr)}</Fig>
              </td>
              <td className="hidden py-1.5 pl-3 text-right md:table-cell">
                <Fig>{g.medianMonths == null ? '—' : g.medianMonths.toFixed(1)}</Fig>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Fig>{g.addlLots.toLocaleString()}</Fig>
                <span className="text-muted-foreground"> · </span>
                <Fig className="text-muted-foreground">{fmtGbp(g.addlNet, 0)}</Fig>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Sets are a separate buying decision — different capital and velocity profile from the
 * parts arbitrage, and deliberately never mixed into the parts grade. Persisted since
 * engine v4 and, like the gate ladder, previously CLI-only.
 *
 * The per-set columns mirror the Set Lookup verdict: what the complete set sells for on
 * each channel, what parting it out is worth, and which of those wins.
 */
function SetsPanel({ sets }: { sets: SetsSection }) {
  const methods = [
    { key: 'flipAmazon', label: 'Flip on Amazon', row: sets.methods.flipAmazon },
    { key: 'sellBl', label: 'Sell complete on BL', row: sets.methods.sellBl },
    { key: 'partOut', label: 'Part out', row: sets.methods.partOut },
    { key: 'cmfIdentified', label: 'CMFs identified', row: sets.methods.cmfIdentified },
    { key: 'skip', label: 'No margin', row: sets.methods.skip },
    { key: 'cmfNoIdentity', label: 'CMFs unidentified', row: sets.methods.cmfNoIdentity },
  ].filter((m) => m.row.lots > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <span className="text-muted-foreground">
          {sets.lots.toLocaleString()} set lots · {fmtGbp(sets.askValue, 0)} asked
        </span>
        <span>
          Sellable <Fig className="font-medium">{sets.totalSellable.lots}</Fig> lots ·{' '}
          <Fig>{fmtGbp(sets.totalSellable.outlay, 0)}</Fig> →{' '}
          <Fig className="font-medium">
            <span style={{ color: sets.totalSellable.net > 0 ? SA.goodText : undefined }}>
              {fmtGbp(sets.totalSellable.net, 0)}
            </span>
          </Fig>
        </span>
        {sets.cmfResolvedCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {sets.cmfResolvedCount} bare CMF listing{sets.cmfResolvedCount === 1 ? '' : 's'}{' '}
            resolved by name
          </span>
        )}
      </div>

      {methods.length > 0 && (
        <div className="grid gap-1.5 text-xs sm:max-w-lg">
          {methods.map((m) => (
            <div key={m.key} className="grid grid-cols-[10rem_1fr_auto] items-center gap-2">
              <span className="truncate text-muted-foreground">{m.label}</span>
              <Fig className="text-muted-foreground">{m.row.lots} lots</Fig>
              <Fig className="whitespace-nowrap text-right">
                {fmtGbp(m.row.outlay, 0)} <span className="text-foreground/30">→</span>{' '}
                {fmtGbp(m.row.net, 0)}
              </Fig>
            </div>
          ))}
          {/* Part-out's "net" is the POV-vs-ask signal, not money booked — say so where
              it sits next to figures that ARE booked. */}
          {sets.methods.partOut.lots > 0 && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              Part-out net is the POV-minus-ask signal, not a booked margin — it assumes the whole
              set parts out and sells.
            </p>
          )}
        </div>
      )}

      {sets.decided.length > 0 && <SetsTable rows={sets.decided} totalLots={sets.lots} />}
    </div>
  );
}

export function AssessmentDetail({
  a,
  history = [],
  slug,
  wantedList,
}: {
  a: StoreAssessment;
  history?: RunHistoryEntry[];
  slug?: string;
  wantedList?: WantedListMeta | null;
}) {
  const verdictColour =
    a.verdict.label === 'BUY'
      ? SA.good
      : a.verdict.label === 'REVIEW'
        ? SA.warn
        : 'hsl(var(--border))';
  const fresh = a.overlap.available
    ? a.overlap.buyableTags.filter((t) => t.tag === 'NEW' || t.tag === 'RESTOCK_OUT')
    : [];
  const freshLots = fresh.reduce((n, t) => n + t.lots, 0);
  const newTag = a.overlap.buyableTags.find((t) => t.tag === 'NEW');
  const routTag = a.overlap.buyableTags.find((t) => t.tag === 'RESTOCK_OUT');
  const ukStock = hasUkStock(a);

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
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                store.bricklink.com/{a.store.slug} ↗
              </a>{' '}
              · {a.store.country ?? '?'} · scanned {a.scannedAt.slice(0, 16).replace('T', ' ')} ·{' '}
              {a.mode} · engine v{a.engineVersion}
            </p>
            {a.scanTruncated && (
              <p
                className="mt-2 inline-block border px-2 py-1 text-xs font-semibold uppercase tracking-wide"
                style={{ borderColor: SA.warn, color: SA.warnText }}
              >
                ⚠ Scan truncated — totals understate this store
              </p>
            )}
            <ul className="mt-4 max-w-xl space-y-1 text-sm text-muted-foreground">
              {a.verdict.reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-foreground/30">—</span>
                  <span>{tidyReason(r)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <div className="flex items-baseline gap-3">
              <span
                className="font-[family-name:var(--font-sa-display)] text-7xl font-bold leading-none tabular-nums"
                style={{ color: a.verdict.label === 'SKIP' ? undefined : verdictColour }}
              >
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
        {/*
          The ladder leads at double width. Everything to its right is the shape of the
          opportunity; the ladder is its size, and it is the only figure here that has had
          postage, the demand cap and our own existing depth taken off it.
        */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-6">
          <div className="col-span-2">
            <MoneyLadder a={a} />
          </div>
          <Tile
            label="Buyable lots"
            value={a.withinMargin.lots.toLocaleString()}
            sub={`of ${a.size.totalLots.toLocaleString()} in store · ${fmtGbp(a.withinMargin.outlay, 0)} outlay`}
          />
          <Tile
            label="ROI"
            value={a.withinMargin.roiPct != null ? `${a.withinMargin.roiPct.toFixed(0)}%` : '—'}
            sub={
              a.withinMargin.blendedMarginPct != null
                ? `${a.withinMargin.blendedMarginPct.toFixed(1)}% blended margin`
                : undefined
            }
          />
          <Tile
            label="Fresh demand"
            value={a.overlap.available ? freshLots.toLocaleString() : '—'}
            accent={freshLots > 0 ? SA.good : undefined}
            sub={
              a.overlap.available
                ? `${newTag?.lots ?? 0} new · ${routTag?.lots ?? 0} restock`
                : 'no overlap data this run'
            }
          />
          <Tile
            label="Magnets"
            value={a.magnets.lots.toLocaleString()}
            sub={`${a.magnets.alsoWithinMargin} also buyable`}
          />
        </div>
        {a.overlap.available && a.overlap.freshNetShare != null && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Fresh demand share of buyable net</span>
            <ShareMeter share={a.overlap.freshNetShare} width="w-40" />
            <span className="text-xs">
              snapshot {a.overlap.snapshotAt ? a.overlap.snapshotAt.slice(0, 10) : '?'} · sales
              window {a.overlap.salesWindowDays ?? '—'}d
            </span>
          </div>
        )}
      </section>

      {/* ── 02 · Buy list ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Kicker n="02">Buy list — top lots within margin</Kicker>
          <span className="text-xs text-muted-foreground">
            ≥{fmtPct(a.inputs.minMargin)} net margin · inbound {fmtGbp(a.inputs.inboundPerUnit)}
            {a.inputs.inboundPerUnit === 0 ? ' (ex-postage)' : ''}/unit
          </span>
        </div>
        {/*
          The wanted list covers the WHOLE store, not the 12 rows below it — it was
          generated at scan time from the full scored set, which is why it is a stored
          file rather than something this page assembles. Saying so is the point: the
          table is a sample, the download is not.
        */}
        {slug && <WantedListLink slug={slug} meta={wantedList ?? null} />}
        <LotTable rows={a.withinMargin.top} kind="margin" totalLots={a.withinMargin.lots} />
        {a.withinMargin.lots > a.withinMargin.top.length && (
          <p className="text-xs text-muted-foreground">
            Run <Fig>/bl-basket {a.store.slug}</Fig> for the full cart.
          </p>
        )}
      </section>

      {/* ── 03 · The gate ladder ──────────────────────────────────── */}
      {a.strCoverage && a.strCoverage.gates.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker n="03">Gate ladder — what survives each STR cut</Kicker>
            <span className="text-xs text-muted-foreground">
              benchmark cover {a.strCoverage.coverage.ukLots.toLocaleString()} UK ·{' '}
              {a.strCoverage.coverage.worldLots.toLocaleString()} world† ·{' '}
              {a.strCoverage.coverage.noneLots.toLocaleString()} none
            </span>
          </div>
          <GateLadder gates={a.strCoverage.gates} />
        </section>
      )}

      {/* ── 04/05 · Fast movers & magnets ─────────────────────────── */}
      <section className="grid gap-8 xl:grid-cols-2">
        <div className="space-y-3">
          <Kicker n="04">Fast movers</Kicker>
          {/*
            Quantity basis, stated. The engine gates highStr on strQty and ranks by it;
            the caption used to say "lots basis" beside a column rendering strLots, so the
            list read as mis-sorted and the threshold named the wrong number.
          */}
          <p className="text-xs text-muted-foreground">
            STR ≥ {a.inputs.minStr} (quantity basis) · {a.highStr.lots} lots ·{' '}
            {fmtGbp(a.highStr.value)} · {a.highStr.alsoWithinMargin} also buyable
          </p>
          <LotTable rows={a.highStr.top} kind="str" totalLots={a.highStr.lots} ukStock={ukStock} />
        </div>
        <div className="space-y-3">
          <Kicker n="05">Magnets — scarce + selling</Kicker>
          {/*
            The gate THIS run was scored on. The old caption quoted
            inputs.magnetMaxSupplyLots unconditionally, which the engine stopped reading
            when magnets moved to UK stock quantity — but for a run predating that move it
            is exactly right, and UK_MAGNET would be exactly wrong. So it branches.
          */}
          {ukStock ? (
            <p className="text-xs text-muted-foreground">
              UK stock under {UK_MAGNET.part.ukStockQtyUnder} pieces (minifigs{' '}
              {UK_MAGNET.minifig.ukStockQtyUnder}) + STR over {UK_MAGNET.part.strAbove}, both
              quantity basis · {a.magnets.lots} lots · {fmtGbp(a.magnets.value)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              ≤{a.inputs.magnetMaxSupplyLots} sellers worldwide + STR ≥ {a.inputs.minStr} (quantity
              basis) · {a.magnets.lots} lots · {fmtGbp(a.magnets.value)}
              <span className="block" style={{ color: SA.warnText }}>
                Run predates the UK stock-quantity gate — re-run to score magnets on UK scarcity.
              </span>
            </p>
          )}
          <LotTable
            rows={a.magnets.top}
            kind="magnet"
            totalLots={a.magnets.lots}
            ukStock={ukStock}
          />
        </div>
      </section>

      {/* ── 06 · Sets ─────────────────────────────────────────────── */}
      {a.sets && a.sets.lots > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker n="06">Sets — a separate decision</Kicker>
            <span className="text-xs text-muted-foreground">
              scored apart from the parts grade — different capital and velocity
            </span>
          </div>
          <SetsPanel sets={a.sets} />
        </section>
      )}

      {/* ── 07 · Run history ──────────────────────────────────────── */}
      {history.length > 1 && (
        <section className="space-y-3">
          <Kicker n="07">Run history</Kicker>
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
                    <td className="py-1.5">
                      <Fig className="text-xs">{h.scannedAt.slice(0, 10)}</Fig>
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">{h.mode}</td>
                    <td className="py-1.5 pl-3 text-right">
                      <Fig>{h.grade?.toFixed(0) ?? '—'}</Fig>
                    </td>
                    <td className="py-1.5 pl-4">
                      {h.verdict ? <VerdictChip label={h.verdict} /> : '—'}
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      <Fig>{h.buyableLots ?? '—'}</Fig>
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      <Fig>{h.buyableFreshLots ?? '—'}</Fig>
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      <Fig>{fmtGbp(h.buyableNetGbp, 0)}</Fig>
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      <Fig>
                        {h.medianAskVsMarket != null
                          ? `${Math.round(h.medianAskVsMarket * 100)}%`
                          : '—'}
                      </Fig>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 08 · Diagnostics ──────────────────────────────────────── */}
      <section className="space-y-4">
        <Kicker n="08">Diagnostics</Kicker>
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Pricing — {a.pricing.label}
              {a.pricing.weightedMedianAskVsMarket != null && (
                <span className="ml-2 font-normal normal-case text-muted-foreground">
                  wtd median {Math.round(a.pricing.weightedMedianAskVsMarket * 100)}% of market
                </span>
              )}
            </h3>
            <BucketBars
              buckets={a.pricing.positions}
              colourFor={(k) => POSITION_COLOUR[k] ?? 'hsl(var(--foreground) / 0.6)'}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Ageing{' '}
              {a.ageing.motivatedSeller && (
                <span className="ml-1" style={{ color: SA.warnText }}>
                  · motivated seller
                </span>
              )}
            </h3>
            <BucketBars
              buckets={a.ageing.buckets}
              colourFor={(k) =>
                k.startsWith('overstock') || k.startsWith('dead')
                  ? SA.warn
                  : k.startsWith('no benchmark')
                    ? 'hsl(var(--muted-foreground) / 0.4)'
                    : 'hsl(var(--foreground) / 0.6)'
              }
            />
            <p className="text-[11px] text-muted-foreground">
              signal over the {fmtPct(a.ageing.benchmarkedValueShare)} of value with a benchmark
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Benchmark confidence
            </h3>
            <div className="grid gap-1.5 text-xs">
              {[
                { label: 'UK price data', v: a.confidence.ukValueShare, c: SA.good },
                { label: 'World +11% calibration', v: a.confidence.worldValueShare, c: SA.info },
                {
                  label: 'No benchmark',
                  v: a.confidence.noneValueShare,
                  c: 'hsl(var(--muted-foreground) / 0.4)',
                },
              ].map((r) => (
                <div
                  key={r.label}
                  className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-2"
                >
                  <span className="truncate text-muted-foreground">{r.label}</span>
                  <span className="relative inline-block h-[5px] overflow-hidden rounded-sm bg-muted">
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{ width: `${Math.round(r.v * 100)}%`, background: r.c }}
                    />
                  </span>
                  <Fig className="text-right text-muted-foreground">{fmtPct(r.v)}</Fig>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Part mix
            </h3>
            <table className="w-full text-xs">
              <tbody>
                {a.partMix.matrix.map((c) => (
                  <tr key={`${c.itemType}${c.condition}`} className="border-b border-border/40">
                    <td className="py-1 text-muted-foreground">
                      {c.itemType === 'P' ? 'Parts' : c.itemType === 'S' ? 'Sets' : 'Minifigs'}{' '}
                      {c.condition === 'N' ? 'New' : 'Used'}
                    </td>
                    <td className="py-1 text-right">
                      <Fig>{c.lots.toLocaleString()} lots</Fig>
                    </td>
                    <td className="py-1 text-right">
                      <Fig>{fmtGbp(c.value, 0)}</Fig>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground">
              new/used {fmtPct(a.partMix.newValueShare)}/{fmtPct(a.partMix.usedValueShare)} by value
              · damage notes {fmtPct(a.partMix.damageNoteShare, 1)} of used lots
              {a.partMix.setCompleteness.complete +
                a.partMix.setCompleteness.incomplete +
                a.partMix.setCompleteness.sealed >
                0 &&
                ` · sets ${a.partMix.setCompleteness.complete}✓ ${a.partMix.setCompleteness.incomplete}✗ ${a.partMix.setCompleteness.sealed} sealed`}
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Store shape
            </h3>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Lots · pieces</span>
                <Fig>
                  {a.size.totalLots.toLocaleString()} · {a.size.totalPieces.toLocaleString()}
                </Fig>
              </div>
              <div className="flex justify-between">
                <span>Store value</span>
                <Fig>{fmtGbp(a.size.totalValue, 0)}</Fig>
              </div>
              <div className="flex justify-between">
                <span>Median ask</span>
                <Fig>{fmtGbp(a.size.medianLotPrice)}</Fig>
              </div>
              <div className="flex justify-between">
                <span>Top-10 lots share</span>
                <Fig>{fmtPct(a.concentration.top10ValueShare)}</Fig>
              </div>
              <div className="flex justify-between">
                <span>Distinct items</span>
                <Fig>{a.concentration.distinctItems.toLocaleString()}</Fig>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground/70">
              Seller
            </h3>
            {a.feedback ? (
              <div className="grid gap-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Feedback</span>
                  <Fig>
                    {a.feedback.feedbackScore?.toLocaleString() ?? '—'}
                    {a.feedback.positivePct != null ? ` · ${a.feedback.positivePct}% +` : ''}
                  </Fig>
                </div>
                <div className="flex justify-between">
                  <span>Order rate</span>
                  <Fig>
                    {a.feedback.ordersPerMonth != null ? `≈${a.feedback.ordersPerMonth}/mo` : '—'}
                  </Fig>
                </div>
                <div className="flex justify-between">
                  <span>Member since</span>
                  <Fig>{a.feedback.memberSince ?? '—'}</Fig>
                </div>
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
