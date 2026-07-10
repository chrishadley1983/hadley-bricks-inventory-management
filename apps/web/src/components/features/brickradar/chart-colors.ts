/**
 * BrickRadar chart color tokens (dataviz skill method).
 *
 * The app's own shadcn `--chart-1..5` tokens FAIL the categorical CVD-separation
 * check (validated via the dataviz skill's `validate_palette.js` — worst adjacent
 * pair ΔE 6.0, below the ≥8 floor). Rather than repaint the whole app's chart
 * tokens (out of scope here — shared `components/charts/*`), BrickRadar defines
 * its own small, VALIDATED set of CSS custom properties, scoped to this page via
 * `CHART_VARS_CLASSNAME` on a wrapping element. Every chart under that element
 * can reference `var(--lane-catalogpg)` etc — SVG presentation attributes accept
 * `var()` in all evergreen browsers, and the light/dark halves swap automatically
 * because this app's dark mode is the `.dark` class strategy (tailwind.config.ts).
 *
 * Sources:
 * - Categorical (lane identity) + diverging (risers/fallers): the dataviz skill's
 *   validated reference palette (blue/aqua/yellow/green/violet categorical order;
 *   worst adjacent ΔE 24.2 light / 10.3 dark — see references/palette.md).
 * - Diverging trend-movers pair reuses this app's own established green=up/red=down
 *   convention (already used throughout BrickRadar v1 and the wider dashboard) —
 *   CVD-checked separately (ΔE 20.6 deutan, well clear of the ≥12 target); the
 *   neutral zero-line uses `hsl(var(--muted-foreground))`, already theme-aware.
 * - Ordinal (next-due buckets): one hue (blue), monotone lightness steps from the
 *   same reference palette's sequential ramp.
 * - Status (good/warn/serious): this app's existing green-600/amber-600/red-600
 *   (dark: -400) text/badge convention — always paired with an icon + label,
 *   never color-alone, per the dataviz status-color rule.
 */

/** Fixed lane → categorical slot order. Never reassigned by rank/value. */
export const LANE_ORDER = ['catalogpg', 'anon_curl', 'store_api', 'brickstore_batch', 'canary'] as const;
export type Lane = (typeof LANE_ORDER)[number];

export const LANE_VAR: Record<Lane, string> = {
  catalogpg: '--lane-catalogpg',
  anon_curl: '--lane-anon_curl',
  store_api: '--lane-store_api',
  brickstore_batch: '--lane-brickstore_batch',
  canary: '--lane-canary',
};

export function laneColorVar(lane: string): string {
  return `var(${LANE_VAR[lane as Lane] ?? '--lane-canary'})`;
}

/** Diverging trend-mover colors (positive/riser, negative/faller). */
export const TREND_POS_VAR = 'var(--trend-pos)';
export const TREND_NEG_VAR = 'var(--trend-neg)';

/** Ordinal ramp for the next-due distribution (light → dark, one hue). */
export const SEQ_STEPS = ['--seq-0', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5'] as const;
export function seqVar(index: number): string {
  const clamped = Math.max(0, Math.min(SEQ_STEPS.length - 1, index));
  return `var(${SEQ_STEPS[clamped]})`;
}

/** Reserved status colors — always ship with an icon + label, never color-alone. */
export const STATUS_TEXT = {
  good: 'text-green-600 dark:text-green-400',
  warn: 'text-amber-600 dark:text-amber-400',
  serious: 'text-red-600 dark:text-red-400',
} as const;

export const STATUS_BAR_VAR = {
  good: 'var(--status-good)',
  warn: 'var(--status-warn)',
  serious: 'var(--status-serious)',
} as const;

/**
 * Apply to a single wrapping element (BrickRadar's page root) — every recharts
 * primitive nested inside can then reference `var(--lane-catalogpg)` etc, and the
 * hex value swaps per-mode automatically via the `.dark` class strategy.
 */
export const CHART_VARS_CLASSNAME =
  '[--lane-catalogpg:#2a78d6] dark:[--lane-catalogpg:#3987e5] ' +
  '[--lane-anon_curl:#1baf7a] dark:[--lane-anon_curl:#199e70] ' +
  '[--lane-store_api:#eda100] dark:[--lane-store_api:#c98500] ' +
  '[--lane-brickstore_batch:#008300] ' +
  '[--lane-canary:#4a3aa7] dark:[--lane-canary:#9085e9] ' +
  '[--trend-pos:#16a34a] dark:[--trend-pos:#4ade80] ' +
  '[--trend-neg:#dc2626] dark:[--trend-neg:#f87171] ' +
  '[--seq-0:#86b6ef] [--seq-1:#6da7ec] [--seq-2:#5598e7] [--seq-3:#3987e5] [--seq-4:#2a78d6] [--seq-5:#256abf] ' +
  '[--status-good:#16a34a] dark:[--status-good:#4ade80] ' +
  '[--status-warn:#d97706] dark:[--status-warn:#fbbf24] ' +
  '[--status-serious:#dc2626] dark:[--status-serious:#f87171]';

/** Shared recharts tooltip content style — theme-aware surface + border. */
export const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '12px',
};
