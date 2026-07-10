import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { saFonts } from '@/components/features/store-assessment/fonts';
import {
  Fig, Tile, VerdictChip, GradeMeter, DeltaChip, MarketPosition, SA, fmtGbp,
} from '@/components/features/store-assessment/primitives';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  scanned_at: string;
  store_slug: string;
  store_name: string | null;
  store_country: string | null;
  mode: string;
  scan_truncated: boolean | null;
  grade: number | null;
  verdict: string | null;
  total_lots: number | null;
  total_value: number | null;
  median_ask_vs_market: number | null;
  buyable_lots: number | null;
  buyable_fresh_lots: number | null;
  buyable_net_gbp: number | null;
  magnet_lots: number | null;
}

const LIST_COLS = 'id,scanned_at,store_slug,store_name,store_country,mode,scan_truncated,grade,verdict,total_lots,total_value,median_ask_vs_market,buyable_lots,buyable_fresh_lots,buyable_net_gbp,magnet_lots';
// Supabase caps responses at 1,000 rows — page through run history so latest-per-store
// dedupe sees every store. Hard cap keeps it bounded.
const MAX_HISTORY_ROWS = 20000;

const num = (v: number | string | null) => (v == null ? null : Number(v));
const gbp0 = (n: number | null) => fmtGbp(n, 0);

function relAge(iso: string): string {
  const days = (Date.now() - Date.parse(iso)) / 86400000;
  if (days < 1) return 'today';
  if (days < 2) return '1d';
  return `${Math.floor(days)}d`;
}
/** Full phrase for prose: "today" | "1d ago" | "Nd ago". */
const relAgePhrase = (iso: string) => { const a = relAge(iso); return a === 'today' ? 'today' : `${a} ago`; };

const FILTERS = ['ALL', 'BUY', 'REVIEW', 'SKIP'] as const;

export default async function StoreAssessmentListPage({
  searchParams,
}: {
  searchParams: Promise<{ verdict?: string }>;
}) {
  const { verdict: filterRaw } = await searchParams;
  const filter = FILTERS.includes((filterRaw ?? 'ALL').toUpperCase() as (typeof FILTERS)[number])
    ? (filterRaw ?? 'ALL').toUpperCase()
    : 'ALL';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const rows: Row[] = [];
  for (let from = 0; from < MAX_HISTORY_ROWS; from += 1000) {
    const { data } = await supabase
      .from('store_assessments')
      .select(LIST_COLS)
      .order('scanned_at', { ascending: false })
      .range(from, from + 999);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  // Latest run per store, plus the most recent prior COMPARABLE run (same mode,
  // same truncation state) — a light-vs-full or truncated comparison would show
  // phantom deltas on the very column the table ranks by.
  const latest = new Map<string, Row>();
  const previous = new Map<string, Row>();
  for (const r of rows) {
    const head = latest.get(r.store_slug);
    if (!head) latest.set(r.store_slug, r);
    else if (
      !previous.has(r.store_slug) &&
      r.mode === head.mode &&
      Boolean(r.scan_truncated) === Boolean(head.scan_truncated)
    ) previous.set(r.store_slug, r);
  }

  // Watchlist coverage + directory freshness for the strip.
  const [{ count: watchlistTotal }, { data: dirScan }] = await Promise.all([
    supabase.from('store_assessment_watchlist').select('id', { count: 'exact', head: true }).eq('enabled', true),
    supabase.from('store_directory_scans').select('scanned_at,stores_found').order('scanned_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const stores = [...latest.values()].sort((a, b) => (num(b.buyable_net_gbp) ?? -1) - (num(a.buyable_net_gbp) ?? -1));
  const filtered = filter === 'ALL' ? stores : stores.filter((s) => s.verdict === filter);

  const buys = stores.filter((s) => s.verdict === 'BUY');
  // Round-then-sum so the tile foots to the visible Net column in the ALL view.
  const netOnTable = stores
    .filter((s) => s.verdict === 'BUY' || s.verdict === 'REVIEW')
    .reduce((acc, s) => acc + Math.round(num(s.buyable_net_gbp) ?? 0), 0);
  const lastSweep = stores.length ? stores.map((s) => s.scanned_at).sort().at(-1)! : null;
  const coverage = watchlistTotal ? stores.length / watchlistTotal : null;
  const nextDirScan = dirScan ? new Date(Date.parse(dirScan.scanned_at) + 90 * 86400000) : null;

  const counts: Record<string, number> = { ALL: stores.length };
  for (const f of FILTERS.slice(1)) counts[f] = stores.filter((s) => s.verdict === f).length;

  return (
    <div className={`${saFonts} space-y-6 p-6`}>
      {/* Masthead */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="font-[family-name:var(--font-sa-display)] text-3xl font-bold uppercase leading-none tracking-[0.04em]">
            Store Radar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {watchlistTotal?.toLocaleString() ?? '—'} England stores on watch · nightly sweep 02:15 · the assess lens of BL Arbitrage
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>last sweep {lastSweep ? relAgePhrase(lastSweep) : '—'}</div>
          <div>directory re-scan due {nextDirScan ? nextDirScan.toISOString().slice(0, 10) : 'now'}</div>
        </div>
      </header>

      {/* Stat strip */}
      <section className="grid grid-cols-1 gap-x-6 gap-y-4 min-[480px]:grid-cols-2 sm:grid-cols-4">
        <Tile label="Net on table" value={gbp0(netOnTable)} accent={netOnTable > 100 ? SA.good : undefined} sub="latest BUY + REVIEW runs · ex-postage" />
        <Tile label="BUY verdicts" value={buys.length} accent={buys.length ? SA.good : undefined} sub={buys.length ? buys.slice(0, 2).map((b) => b.store_name ?? b.store_slug).join(' · ') : 'none live'} />
        <Tile label="Magnet lots" value={stores.reduce((a, s) => a + (s.magnet_lots ?? 0), 0)} sub="scarce + selling, all stores" />
        <Tile
          label="Coverage"
          value={<>{stores.length.toLocaleString()}<span className="text-base text-muted-foreground"> / {watchlistTotal?.toLocaleString() ?? '—'}</span></>}
          sub={
            <span className="flex items-center gap-2">
              <span className="relative inline-block h-[5px] w-20 overflow-hidden rounded-sm bg-muted">
                <span className="absolute inset-y-0 left-0 rounded-sm bg-foreground/60" style={{ width: `${Math.round((coverage ?? 0) * 100)}%` }} />
              </span>
              stores assessed
            </span>
          }
        />
      </section>

      {/* Filter chips */}
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <Link
              key={f}
              href={f === 'ALL' ? '/arbitrage/store-assessment' : `/arbitrage/store-assessment?verdict=${f}`}
              className={`border px-3 py-2 font-[family-name:var(--font-sa-display)] text-xs font-semibold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:py-1 ${
                active ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
              }`}
            >
              {f} <span className="text-[10px]">{counts[f]}</span>
            </Link>
          );
        })}
      </nav>

      {/* League table */}
      {filtered.length === 0 ? (
        <div className="border border-dashed border-border p-8 text-sm text-muted-foreground">
          {stores.length === 0 ? (
            <>
              No assessments yet — the nightly sweep will start filling this in, or run one now:
              <pre className="mt-3 overflow-x-auto bg-muted p-3 text-xs">cd apps/web && npx tsx scripts/store-assessment-batch.ts --budget=5</pre>
            </>
          ) : (
            <>Nothing graded {filter} yet.</>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="sticky left-0 z-10 bg-background py-2 pr-2 font-medium">#</th>
                <th className="sticky left-6 z-10 bg-background py-2 pr-4 font-medium">Store</th>
                <th className="py-2 pr-4 font-medium">Grade</th>
                <th className="py-2 pr-4 font-medium">Verdict</th>
                <th className="py-2 pr-4 text-right font-medium">Lots</th>
                <th className="py-2 pr-4 text-right font-medium">Value</th>
                <th className="py-2 pr-4 text-right font-medium" title="Value-weighted median ask vs 6-mo market avg">Vs mkt</th>
                <th className="py-2 pr-4 text-right font-medium">Buyable</th>
                <th className="py-2 pr-4 text-right font-medium" title="Buyable lots NEW to us or restocking sold-out items">Fresh</th>
                <th className="py-2 pr-4 text-right font-medium" title="Projected net after fees, ex-postage — the table is ranked by this column">
                  Net <span className="font-normal normal-case tracking-normal text-muted-foreground">· ranked</span>
                </th>
                <th className="py-2 pr-4 text-right font-medium" title="Buyable net vs this store's previous comparable run (same mode and truncation state)">Δ net</th>
                <th className="py-2 text-right font-medium">Scan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const prev = previous.get(r.store_slug);
                const dNet = prev && num(r.buyable_net_gbp) != null && num(prev.buyable_net_gbp) != null
                  ? (num(r.buyable_net_gbp) as number) - (num(prev.buyable_net_gbp) as number)
                  : null;
                return (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="sticky left-0 z-10 w-6 bg-background py-1.5 pr-2 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="sticky left-6 z-10 max-w-[16rem] border-r border-border/60 bg-background py-1.5 pr-4">
                      <Link href={`/arbitrage/store-assessment/${encodeURIComponent(r.store_slug)}`} className="block truncate font-medium underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {r.store_name ?? r.store_slug}
                      </Link>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {r.store_slug} · {r.mode}{r.scan_truncated ? <span style={{ color: SA.warnText }}> · truncated</span> : ''}
                      </div>
                    </td>
                    <td className="py-1.5 pr-4"><GradeMeter grade={num(r.grade)} /></td>
                    <td className="py-1.5 pr-4">{r.verdict ? <VerdictChip label={r.verdict} /> : '—'}</td>
                    <td className="py-1.5 pr-4 text-right"><Fig>{r.total_lots?.toLocaleString() ?? '—'}</Fig></td>
                    <td className="py-1.5 pr-4 text-right"><Fig>{gbp0(num(r.total_value))}</Fig></td>
                    <td className="py-1.5 pr-4 text-right"><MarketPosition ratio={num(r.median_ask_vs_market)} /></td>
                    <td className="py-1.5 pr-4 text-right"><Fig>{r.buyable_lots?.toLocaleString() ?? '—'}</Fig></td>
                    <td className="py-1.5 pr-4 text-right">
                      <Fig>{r.buyable_fresh_lots != null ? <span style={r.buyable_fresh_lots > 0 ? { color: SA.goodText } : undefined}>{r.buyable_fresh_lots}</span> : '—'}</Fig>
                    </td>
                    <td className="py-1.5 pr-4 text-right"><Fig className="text-[15px] font-semibold">{gbp0(num(r.buyable_net_gbp))}</Fig></td>
                    <td className="py-1.5 pr-4 text-right"><DeltaChip value={dNet} /></td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground"><Fig>{relAge(r.scanned_at)}</Fig></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Net = projected after fees, ex-postage · Fresh = buyable lots new to us or restocking sold-out items · Vs mkt = value-weighted median ask vs 6-mo market avg.
        Ranked by net, latest run per store; Δ net vs the previous comparable run (same mode &amp; truncation state).
      </p>
    </div>
  );
}
