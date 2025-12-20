'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { AlertCircle, Loader2 } from 'lucide-react';

interface WidgetProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  isLoading?: boolean;
  error?: Error | null;
  className?: string;
  children: React.ReactNode;
}

/**
 * Reusable Widget component for dashboard cards.
 * Handles loading, error, and data states consistently.
 */
export function Widget({
  title,
  description,
  icon,
  isLoading = false,
  error = null,
  className,
  children,
}: WidgetProps) {
  return (
    <Card className={cn('relative', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {icon && <div className="h-4 w-4 text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetLoading />
        ) : error ? (
          <WidgetError message={error.message} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Loading state for widgets
 */
function WidgetLoading() {
  return (
    <div className="flex items-center justify-center py-4">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Error state for widgets
 */
function WidgetError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-destructive">
      <AlertCircle className="h-4 w-4" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

interface StatWidgetProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  isLoading?: boolean;
  error?: Error | null;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

/**
 * Stat Widget for displaying key metrics
 */
export function StatWidget({
  title,
  value,
  subtitle,
  icon,
  isLoading = false,
  error = null,
  trend,
  className,
}: StatWidgetProps) {
  return (
    <Card className={cn('relative', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon && <div className="h-4 w-4 text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetLoading />
        ) : error ? (
          <WidgetError message={error.message} />
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            {trend && (
              <p
                className={cn(
                  'mt-1 text-xs',
                  trend.isPositive ? 'text-green-600' : 'text-red-600'
                )}
              >
                {trend.isPositive ? '+' : ''}
                {trend.value}% from last month
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ListWidgetProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  isLoading?: boolean;
  error?: Error | null;
  emptyMessage?: string;
  items: React.ReactNode[];
  className?: string;
}

/**
 * List Widget for displaying lists of items
 */
export function ListWidget({
  title,
  description,
  icon,
  isLoading = false,
  error = null,
  emptyMessage = 'No items',
  items,
  className,
}: ListWidgetProps) {
  return (
    <Card className={cn('relative', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {icon && <div className="h-4 w-4 text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetLoading />
        ) : error ? (
          <WidgetError message={error.message} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="space-y-3">{items}</div>
        )}
      </CardContent>
    </Card>
  );
}
