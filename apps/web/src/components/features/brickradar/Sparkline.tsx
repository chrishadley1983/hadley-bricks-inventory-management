'use client';

import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_TOOLTIP_STYLE } from './chart-colors';

export interface SparklineSeries {
  key: string;
  color: string;
  label: string;
}

interface SparklinePoint {
  label: string;
  [seriesKey: string]: string | number | null;
}

/**
 * A single- or dual-series inline trend line for a stat tile. Deliberately axis-
 * and grid-free (the hero number carries the value; this only carries the shape),
 * but keeps a hover tooltip per the dataviz interaction rule — a plotted line
 * always ships hover, even a small one.
 */
export function Sparkline({
  data,
  series,
  height = 32,
}: {
  data: SparklinePoint[];
  series: SparklineSeries[];
  height?: number;
}) {
  if (data.length < 2) {
    return <div style={{ height }} className="flex items-center text-[10px] text-muted-foreground">Not enough history yet</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelClassName="text-xs"
          wrapperStyle={{ zIndex: 50 }}
          formatter={(value: number | string | undefined, name: string | undefined) => [value ?? '—', name ?? '']}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
