'use client';

import { Sparkline } from './Sparkline';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  /** Label for the metric */
  label: string;
  /** Current value */
  current: number;
  /** Target value */
  target: number;
  /** History data for sparkline */
  history?: number[];
  /** Whether the value is currency */
  isCurrency?: boolean;
  /** Format function for the value */
  formatValue?: (value: number) => string;
  /** Icon to display */
  icon?: React.ReactNode;
  className?: string;
}

export function MetricCard({
  label,
  current,
  target,
  history,
  isCurrency = false,
  formatValue,
  icon,
  className,
}: MetricCardProps) {
  const percentage = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const gap = target - current;

  const format = formatValue || ((value: number) => {
    if (isCurrency) {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    return new Intl.NumberFormat('en-GB').format(value);
  });

  const getGapText = () => {
    if (gap > 0) {
      return `${format(gap)} to go`;
    } else if (gap < 0) {
      return `${format(Math.abs(gap))} ahead`;
    }
    return 'Target met!';
  };

  const getProgressColor = () => {
    if (percentage >= 100) return 'bg-green-500';
    if (percentage >= 75) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-500';
    if (percentage >= 25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <span className="text-sm font-medium">{label}</span>
        </div>
        {history && history.length > 0 && (
          <Sparkline
            data={history}
            width={60}
            height={20}
            color={percentage >= 75 ? 'hsl(142.1 76.2% 36.3%)' : 'hsl(var(--primary))'}
          />
        )}
      </div>

      {/* Value */}
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold">{format(current)}</span>
        <span className="text-sm text-muted-foreground">/ {format(target)}</span>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full transition-all duration-300', getProgressColor())}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Gap text */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{getGapText()}</span>
        <span className="text-xs font-medium">{percentage}%</span>
      </div>
    </div>
  );
}
