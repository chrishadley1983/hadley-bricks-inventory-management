'use client';

/**
 * Dependency-free inline-SVG bar sparkline for KPI cards.
 * Thin marks, rounded data ends; native tooltip per bar. The final bar is
 * treated as PROVISIONAL (in-progress period): translucent fill + outline,
 * so a partial month never reads as a completed one. Zero/negative values
 * render as a baseline tick, not a fake bar.
 */
export function BarSparkline({
  values,
  labels,
  height = 36,
  barColor = '#94a3b8',
  emphasisColor = '#0f172a',
}: {
  values: number[];
  /** Tooltip label per bar (same length as values) */
  labels?: string[];
  height?: number;
  barColor?: string;
  emphasisColor?: string;
}) {
  if (!values.length) return null;

  const max = Math.max(...values, 1);
  const barW = 8;
  const gap = 3;
  const width = values.length * (barW + gap) - gap;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Monthly trend"
      className="overflow-visible"
    >
      {values.map((v, i) => {
        const isLast = i === values.length - 1;
        const isZero = v <= 0;
        const h = isZero ? 1 : Math.max(2, (v / max) * (height - 2));
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - h}
            width={barW}
            height={h}
            rx={isZero ? 0 : 2}
            fill={isZero ? barColor : isLast ? emphasisColor : barColor}
            fillOpacity={isZero ? 0.35 : isLast ? 0.35 : 0.55}
            stroke={isLast && !isZero ? emphasisColor : 'none'}
            strokeWidth={isLast && !isZero ? 1 : 0}
          >
            {labels?.[i] && <title>{labels[i]}</title>}
          </rect>
        );
      })}
    </svg>
  );
}
