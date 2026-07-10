/**
 * Store-assessment visual primitives — the "trading-desk ledger" system.
 *
 * Data colours (dataviz-validated on white AND #0a0a0a surfaces, one palette for
 * both modes): emerald #059669 good/BUY/fresh · amber #d97706 warn/REVIEW ·
 * sky #0284c7 info/restock · red #dc2626 over/dead · zinc neutral/SKIP.
 * Every coloured mark ships with a text label — colour is never the only channel.
 * All server components; zero client JS.
 */
import type { Verdict, ScoredLot } from '@/lib/bl-store-assessment/types';
import { PRICE_BANDS } from '@/lib/bl-store-assessment/engine';

export const SA = {
  // mark colours (fills, dots, bars) — dataviz-validated on the light surface
  good: '#059669',
  warn: '#d97706',
  info: '#0284c7',
  bad: '#dc2626',
  // text variants — darkened to clear WCAG AA for small type on white
  goodText: '#047857',
  warnText: '#b45309',
  infoText: '#0369a1',
  badText: '#b91c1c',
} as const;

const GBP_FMT: Record<number, Intl.NumberFormat> = {};
export const fmtGbp = (n: number | null | undefined, dp = 2) => {
  if (n == null) return '—';
  GBP_FMT[dp] ??= new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: dp, maximumFractionDigits: dp });
  return GBP_FMT[dp].format(Number(n));
};
export const fmtPct = (n: number | null | undefined, dp = 0) =>
  n == null ? '—' : `${(Number(n) * 100).toFixed(dp)}%`;

/** Mono data figure — every number in a table wears this. */
export function Fig({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-[family-name:var(--font-sa-mono)] tabular-nums ${className}`}>{children}</span>;
}

/** Condensed uppercase section kicker: "03 · THE MONEY". */
export function Kicker({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-sa-display)] text-[15px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {n && <span className="mr-2 text-foreground/40">{n}</span>}
      {children}
    </h2>
  );
}

export function VerdictChip({ label, size = 'md' }: { label: Verdict['label'] | string; size?: 'md' | 'lg' }) {
  const tone =
    label === 'BUY'
      ? 'bg-[#047857] text-white'
      : label === 'REVIEW'
        ? 'bg-[#b45309] text-white'
        : 'bg-muted text-muted-foreground border border-border';
  const pad = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]';
  return (
    <span className={`inline-flex items-center font-[family-name:var(--font-sa-display)] font-semibold uppercase tracking-[0.12em] ${pad} ${tone}`}>
      {label}
    </span>
  );
}

/**
 * Grade meter: thin 0–100 bar with tick marks at the verdict thresholds (35/60),
 * fill coloured by band. Always paired with the numeral (never colour-alone).
 */
export function GradeMeter({ grade }: { grade: number | null }) {
  if (grade == null) return <span className="text-muted-foreground">—</span>;
  const colour = grade >= 60 ? SA.good : grade >= 35 ? SA.warn : 'hsl(var(--muted-foreground))';
  return (
    <span className="inline-flex items-center gap-2">
      <Fig className="w-9 text-right text-sm font-medium">{grade.toFixed(0)}</Fig>
      <span className="relative inline-block h-[6px] w-14 overflow-hidden rounded-sm bg-muted">
        <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.min(100, grade)}%`, background: colour }} />
        {/* threshold ticks at REVIEW 35 / BUY 60 */}
        <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: '35%' }} />
        <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: '60%' }} />
      </span>
    </span>
  );
}

/** Share meter 0..1 — thin fill + % figure. */
export function ShareMeter({ share, colour = SA.good, width = 'w-24' }: { share: number | null; colour?: string; width?: string }) {
  if (share == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`relative inline-block h-[6px] ${width} overflow-hidden rounded-sm bg-muted`}>
        <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.min(100, Math.round(share * 100))}%`, background: colour }} />
      </span>
      <Fig className="text-xs text-muted-foreground">{fmtPct(share)}</Fig>
    </span>
  );
}

/** Run-over-run delta: ▲/▼ with signed figure; quiet em-dash when flat/absent. */
export function DeltaChip({ value, kind = 'gbp' }: { value: number | null; kind?: 'gbp' | 'pts' }) {
  if (value == null || Math.abs(value) < (kind === 'gbp' ? 0.5 : 0.5)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const up = value > 0;
  const text = kind === 'gbp' ? fmtGbp(Math.abs(value), 0) : `${Math.abs(value).toFixed(0)}`;
  return (
    <Fig className="text-xs font-medium" >
      <span style={{ color: up ? SA.goodText : SA.badText }}>
        {up ? '▲' : '▼'} {text}
      </span>
    </Fig>
  );
}

/**
 * The five verdict signals (0..1), finally rendered. Single neutral hue — they're
 * magnitudes of one system; identity comes from the labels, weights shown so the
 * grade is explainable at a glance.
 */
export function SignalBars({ signals }: { signals: Verdict['signals'] }) {
  const rows: Array<{ key: string; label: string; weight: string; v: number }> = [
    { key: 'value', label: 'Value on table', weight: '×.45', v: signals.value },
    { key: 'efficiency', label: 'ROI efficiency', weight: '×.15', v: signals.efficiency },
    { key: 'magnet', label: 'Magnets', weight: '×.15', v: signals.magnet },
    { key: 'coverage', label: 'Benchmark cover', weight: '×.15', v: signals.coverage },
    { key: 'price', label: 'Price posture', weight: '×.10', v: signals.price },
  ];
  return (
    <div className="grid gap-1.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">
            {r.label} <span className="text-[10px]">{r.weight}</span>
          </span>
          <span className="relative inline-block h-[5px] overflow-hidden rounded-sm bg-muted">
            <span className="absolute inset-y-0 left-0 rounded-sm bg-foreground/70" style={{ width: `${Math.round((r.v ?? 0) * 100)}%` }} />
          </span>
          <Fig className="text-right text-muted-foreground">{((r.v ?? 0) * 100).toFixed(0)}</Fig>
        </div>
      ))}
    </div>
  );
}

/** Stat tile — hero number, condensed display numerals, optional footer line. */
export function Tile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className="min-w-0 border-l-2 py-1 pl-3" style={{ borderColor: accent ?? 'hsl(var(--border))' }}>
      <div className="truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="font-[family-name:var(--font-sa-display)] text-2xl font-semibold leading-tight tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Ask-vs-market position figure, banded to the shared PRICE_BANDS semantics. */
export function MarketPosition({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(ratio * 100);
  const colour =
    ratio < PRICE_BANDS.keen ? SA.goodText
    : ratio < PRICE_BANDS.atMarket ? undefined
    : ratio < PRICE_BANDS.premium ? SA.warnText
    : SA.badText;
  return <Fig className="text-sm" ><span style={colour ? { color: colour } : undefined}>{pct}%</span></Fig>;
}

export const OVERLAP_META: Record<string, { label: string; mark: string; text: string; title: string }> = {
  NEW: { label: 'NEW', mark: SA.good, text: SA.goodText, title: 'Not stocked, never sold by us — a new unique lot' },
  RESTOCK_OUT: { label: 'R-OUT', mark: SA.info, text: SA.infoText, title: 'We sold out of this — proven demand restock' },
  RESTOCK_THIN: { label: 'R-THIN', mark: SA.warn, text: SA.warnText, title: 'Stocked, but thin vs our own sell rate' },
  DUPLICATE: { label: 'DUP', mark: 'hsl(var(--muted-foreground))', text: 'hsl(var(--muted-foreground))', title: 'Already stocked with adequate depth' },
};

export function OverlapTag({ s }: { s: ScoredLot }) {
  if (!s.overlap) {
    return <span className="text-muted-foreground" title="No overlap data — sets live outside Bricqer">—</span>;
  }
  const m = OVERLAP_META[s.overlap];
  const qty = (s.overlap === 'DUPLICATE' || s.overlap === 'RESTOCK_THIN') && s.ourQty != null ? ` ×${s.ourQty}` : '';
  return (
    <span
      title={`${m.title}${s.ourQty != null ? ` (our qty ${s.ourQty})` : ''}`}
      className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium"
      style={{ color: m.text }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: m.mark }} />
      {m.label}{qty}
    </span>
  );
}
