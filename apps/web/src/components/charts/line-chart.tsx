'use client';

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  [key: string]: string | number;
}

interface LineConfig {
  dataKey: string;
  name: string;
  color: string;
  strokeWidth?: number;
  dot?: boolean;
}

interface LineChartProps {
  data: DataPoint[];
  xAxisKey: string;
  lines: LineConfig[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  formatXAxis?: (value: string) => string;
  formatYAxis?: (value: number) => string;
  formatTooltip?: (value: number) => string;
}

const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // yellow
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
];

export function LineChart({
  data,
  xAxisKey,
  lines,
  height = 300,
  showGrid = true,
  showLegend = true,
  formatXAxis,
  formatYAxis,
  formatTooltip,
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
        <XAxis
          dataKey={xAxisKey}
          tickFormatter={formatXAxis}
          className="text-xs fill-muted-foreground"
        />
        <YAxis tickFormatter={formatYAxis} className="text-xs fill-muted-foreground" />
        <Tooltip
          formatter={(value: number | undefined) => [
            formatTooltip && value !== undefined ? formatTooltip(value) : (value ?? 0),
          ]}
          labelFormatter={formatXAxis}
          contentStyle={{
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
        {showLegend && <Legend />}
        {lines.map((line, index) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
            strokeWidth={line.strokeWidth || 2}
            dot={line.dot ?? false}
            activeDot={{ r: 6 }}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
