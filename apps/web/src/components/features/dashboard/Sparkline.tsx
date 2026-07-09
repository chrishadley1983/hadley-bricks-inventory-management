'use client';

/**
 * Dependency-free inline-SVG bar sparkline for KPI cards.
 * Thin marks, rounded data ends, final bar emphasised; native tooltip per bar.
 */
export function BarSparkline({
  values,
  labels,
  height = 36,
  barColor = '#94a3b8',
  emphasisColor = '#0d9488',
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
        const h = Math.max(2, (v / max) * (height - 2));
        const isLast = i === values.length - 1;
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - h}
            width={barW}
            height={h}
            rx={2}
            fill={isLast ? emphasisColor : barColor}
            opacity={isLast ? 1 : 0.55}
          >
            {labels?.[i] && <title>{labels[i]}</title>}
          </rect>
        );
      })}
    </svg>
  );
}
