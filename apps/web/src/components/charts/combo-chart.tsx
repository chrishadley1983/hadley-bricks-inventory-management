'use client';

import {
  ComposedChart as RechartsComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface DataPoint {
  [key: string]: string | number;
}

interface BarConfig {
  dataKey: string;
  name: string;
  color: string;
}

interface LineConfig {
  dataKey: string;
  name: string;
  color: string;
  strokeWidth?: number;
  dot?: boolean;
}

interface ComboChartProps {
  data: DataPoint[];
  xAxisKey: string;
  bars: BarConfig[];
  lines: LineConfig[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  showZeroLine?: boolean;
  formatXAxis?: (value: string) => string;
  formatYAxis?: (value: number) => string;
  formatTooltip?: (value: number) => string;
}

export function ComboChart({
  data,
  xAxisKey,
  bars,
  lines,
  height = 300,
  showGrid = true,
  showLegend = true,
  showZeroLine = false,
  formatXAxis,
  formatYAxis,
  formatTooltip,
}: ComboChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsComposedChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
        <XAxis
          dataKey={xAxisKey}
          tickFormatter={formatXAxis}
          className="text-xs fill-muted-foreground"
        />
        <YAxis tickFormatter={formatYAxis} className="text-xs fill-muted-foreground" />
        {showZeroLine && (
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
        )}
        <Tooltip
          formatter={(value: number | undefined, name?: string) => [
            formatTooltip && value !== undefined ? formatTooltip(value) : (value ?? 0),
            name ?? ''
          ]}
          labelFormatter={formatXAxis}
          contentStyle={{
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
        {showLegend && <Legend />}
        {bars.map((bar) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.color}
            radius={[4, 4, 0, 0]}
          />
        ))}
        {lines.map((line) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color}
            strokeWidth={line.strokeWidth || 2}
            dot={line.dot ?? false}
            activeDot={{ r: 6 }}
          />
        ))}
      </RechartsComposedChart>
    </ResponsiveContainer>
  );
}
