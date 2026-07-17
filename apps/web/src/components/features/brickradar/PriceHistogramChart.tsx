'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import { CHART_TOOLTIP_STYLE, TREND_NEG_VAR, laneColorVar } from './chart-colors';
import type { PriceHistogramResult } from './priceHistogram';

/**
 * "STR at my price" — the centrepiece drill-down visual (spec §7). Sequential
 * magnitude (qty sold) as one hue, one series ("Qty sold" — the title names it,
 * no legend box needed), with the Bricqer store floor as a reference
 * line so it reads directly as "how much of this tuple's sold volume happened
 * at or above the price I'd actually list at."
 */
export function PriceHistogramChart({ histogram, floorLabel }: { histogram: PriceHistogramResult; floorLabel: string }) {
  if (histogram.buckets.length === 0) {
    return <p className="text-sm text-muted-foreground">No priced sold transactions to bucket yet.</p>;
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={histogram.buckets} margin={{ top: 5, right: 20, left: 0, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis
            dataKey="label"
            className="text-xs fill-muted-foreground"
            tickLine={false}
            angle={-35}
            textAnchor="end"
            height={50}
            interval={0}
          />
          <YAxis className="text-xs fill-muted-foreground" tickLine={false} width={36} allowDecimals={false} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number | undefined) => [(v ?? 0).toLocaleString(), 'Qty sold']} />
          <Bar dataKey="qty" name="Qty sold" radius={[3, 3, 0, 0]} maxBarSize={40}>
            {histogram.buckets.map((b) => (
              <Cell key={b.label} fill={b.isFloorBucket ? TREND_NEG_VAR : laneColorVar('catalogpg')} />
            ))}
          </Bar>
          <ReferenceLine
            x={histogram.buckets.find((b) => b.isFloorBucket)?.label}
            stroke={TREND_NEG_VAR}
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: floorLabel, position: 'top', className: 'fill-current text-[10px]', fill: TREND_NEG_VAR }}
          />
        </BarChart>
      </ResponsiveContainer>
      {histogram.otherQty > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {histogram.otherQty.toLocaleString()} unit(s) rolled into the long-tail &quot;other&quot; bucket (the scrape caps at 150
          distinct prices).
        </p>
      )}
    </div>
  );
}
