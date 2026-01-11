'use client';

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface DataPoint {
  [key: string]: string | number;
}

interface BarConfig {
  dataKey: string;
  name: string;
  color: string;
  stackId?: string;
}

interface BarChartProps {
  data: DataPoint[];
  xAxisKey: string;
  bars: BarConfig[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  layout?: 'horizontal' | 'vertical';
  formatXAxis?: (value: string) => string;
  formatYAxis?: (value: number) => string;
  formatTooltip?: (value: number) => string;
  colorByValue?: (value: DataPoint) => string;
  onBarClick?: (data: DataPoint) => void;
}

const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // yellow
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
];

export function BarChart({
  data,
  xAxisKey,
  bars,
  height = 300,
  showGrid = true,
  showLegend = true,
  layout = 'horizontal',
  formatXAxis,
  formatYAxis,
  formatTooltip,
  colorByValue,
  onBarClick,
}: BarChartProps) {
  const isVertical = layout === 'vertical';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout={layout}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
        {isVertical ? (
          <>
            <XAxis
              type="number"
              tickFormatter={formatYAxis}
              className="text-xs fill-muted-foreground"
            />
            <YAxis
              type="category"
              dataKey={xAxisKey}
              tickFormatter={formatXAxis}
              className="text-xs fill-muted-foreground"
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={xAxisKey}
              tickFormatter={formatXAxis}
              className="text-xs fill-muted-foreground"
            />
            <YAxis tickFormatter={formatYAxis} className="text-xs fill-muted-foreground" />
          </>
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
        {bars.map((bar, index) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
            stackId={bar.stackId}
            radius={[4, 4, 0, 0]}
            onClick={onBarClick ? (entry: DataPoint) => onBarClick(entry) : undefined}
            style={onBarClick ? { cursor: 'pointer' } : undefined}
          >
            {colorByValue &&
              data.map((entry, i) => <Cell key={`cell-${i}`} fill={colorByValue(entry)} />)}
          </Bar>
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
