/**
 * Investment dashboard chart tokens (dataviz skill method).
 *
 * Every chart on the dashboard is single-series magnitude (one blue hue) or a
 * signed value (the app's established green=up / red=down convention), so this
 * reuses the exact hex values already validated for BrickRadar with the skill's
 * validate_palette.js (see brickradar/chart-colors.ts) — same hues, same light/
 * dark surfaces, no new adjacent-pair combinations to re-validate.
 */

/** Single-hue magnitude bars (blue, mid-ramp step, theme-aware). */
export const MAGNITUDE_VAR = 'var(--inv-magnitude)';

/** Signed values: appreciation vs depreciation. */
export const POS_VAR = 'var(--inv-pos)';
export const NEG_VAR = 'var(--inv-neg)';

/** Apply to the dashboard root so nested recharts marks can use the vars. */
export const INVESTMENT_CHART_VARS_CLASSNAME =
  '[--inv-magnitude:#2a78d6] dark:[--inv-magnitude:#3987e5] ' +
  '[--inv-pos:#16a34a] dark:[--inv-pos:#4ade80] ' +
  '[--inv-neg:#dc2626] dark:[--inv-neg:#f87171]';

/** Shared recharts tooltip content style — theme-aware surface + border. */
export const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '12px',
};
