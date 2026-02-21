'use client';

import { cn } from '@/lib/utils';

interface SparklineProps {
  /** Array of values to display */
  data: number[];
  /** Width of the sparkline */
  width?: number;
  /** Height of the sparkline */
  height?: number;
  /** Stroke color */
  color?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Whether to fill area under line */
  filled?: boolean;
  /** Fill opacity (0-1) */
  fillOpacity?: number;
  /** Show end dot */
  showEndDot?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = 'hsl(var(--primary))',
  strokeWidth = 1.5,
  filled = true,
  fillOpacity = 0.1,
  showEndDot = true,
  className,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-muted-foreground', className)}
        style={{ width, height }}
      >
        <span className="text-[10px]">No data</span>
      </div>
    );
  }

  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Calculate min and max for scaling
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // Avoid division by zero

  // Generate points
  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y };
  });

  // Create line path
  const linePath = points
    .map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  // Create fill path (closed polygon)
  const fillPath = filled
    ? `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`
    : '';

  const lastPoint = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Fill area */}
      {filled && <path d={fillPath} fill={color} fillOpacity={fillOpacity} stroke="none" />}

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* End dot */}
      {showEndDot && lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r={2.5} fill={color} />}
    </svg>
  );
}
