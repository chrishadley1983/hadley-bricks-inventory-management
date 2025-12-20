'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  previousValue?: string | number;
  changePercent?: number;
  format?: 'currency' | 'number' | 'percent';
  icon?: React.ReactNode;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function StatCard({
  title,
  value,
  previousValue,
  changePercent,
  format = 'number',
  icon,
  description,
  trend,
}: StatCardProps) {
  const formatValue = (val: string | number): string => {
    if (typeof val === 'string') return val;
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-GB', {
          style: 'currency',
          currency: 'GBP',
        }).format(val);
      case 'percent':
        return `${val.toFixed(1)}%`;
      default:
        return new Intl.NumberFormat('en-GB').format(val);
    }
  };

  const getTrendIcon = () => {
    if (trend === 'up' || (changePercent !== undefined && changePercent > 0)) {
      return <TrendingUp className="h-4 w-4 text-green-500" />;
    }
    if (trend === 'down' || (changePercent !== undefined && changePercent < 0)) {
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    }
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getTrendColor = () => {
    if (trend === 'up' || (changePercent !== undefined && changePercent > 0)) {
      return 'text-green-500';
    }
    if (trend === 'down' || (changePercent !== undefined && changePercent < 0)) {
      return 'text-red-500';
    }
    return 'text-muted-foreground';
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatValue(value)}</div>
        {(changePercent !== undefined || previousValue !== undefined) && (
          <div className="flex items-center gap-1 mt-1">
            {changePercent !== undefined && (
              <>
                {getTrendIcon()}
                <span className={cn('text-sm', getTrendColor())}>
                  {changePercent > 0 ? '+' : ''}
                  {changePercent.toFixed(1)}%
                </span>
              </>
            )}
            {previousValue !== undefined && (
              <span className="text-xs text-muted-foreground ml-1">
                vs {formatValue(previousValue)}
              </span>
            )}
          </div>
        )}
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}
