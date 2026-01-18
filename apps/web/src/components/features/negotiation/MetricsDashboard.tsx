'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Send,
  CheckCircle,
  Percent,
  TrendingUp,
} from 'lucide-react';
import type { NegotiationMetrics } from '@/lib/ebay/negotiation.types';

interface MetricsDashboardProps {
  metrics?: NegotiationMetrics;
  isLoading?: boolean;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

function MetricCard({ title, value, icon, description, variant = 'default' }: MetricCardProps) {
  const variantStyles = {
    default: 'text-foreground',
    success: 'text-green-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  };

  return (
    <Card data-testid={`metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${variantStyles[variant]}`}>{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-32 mt-1" />
      </CardContent>
    </Card>
  );
}

export function MetricsDashboard({ metrics, isLoading }: MetricsDashboardProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="metrics-dashboard">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="metrics-dashboard">
        <MetricCard
          title="Offers Sent"
          value="0"
          icon={<Send className="h-4 w-4" />}
          description="No offers sent yet"
        />
        <MetricCard
          title="Acceptance Rate"
          value="0%"
          icon={<CheckCircle className="h-4 w-4" />}
          description="Start sending offers to see data"
        />
        <MetricCard
          title="Avg Discount Sent"
          value="0%"
          icon={<Percent className="h-4 w-4" />}
          description="Average discount offered"
        />
        <MetricCard
          title="Avg Discount Converted"
          value="0%"
          icon={<TrendingUp className="h-4 w-4" />}
          description="Avg discount on accepted offers"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="metrics-dashboard">
      <MetricCard
        title="Offers Sent"
        value={metrics.totalOffersSent}
        icon={<Send className="h-4 w-4" />}
        description={`${metrics.offersPending} pending`}
        data-testid="metric-offers-sent"
      />
      <MetricCard
        title="Acceptance Rate"
        value={`${metrics.acceptanceRate}%`}
        icon={<CheckCircle className="h-4 w-4" />}
        description={`${metrics.offersAccepted} accepted, ${metrics.offersDeclined} declined`}
        variant={metrics.acceptanceRate >= 20 ? 'success' : metrics.acceptanceRate >= 10 ? 'warning' : 'default'}
        data-testid="metric-acceptance-rate"
      />
      <MetricCard
        title="Avg Discount Sent"
        value={`${metrics.avgDiscountSent}%`}
        icon={<Percent className="h-4 w-4" />}
        description="Average discount offered"
        data-testid="metric-avg-discount-sent"
      />
      <MetricCard
        title="Avg Discount Converted"
        value={`${metrics.avgDiscountConverted}%`}
        icon={<TrendingUp className="h-4 w-4" />}
        description="Avg discount on accepted offers"
        variant={metrics.avgDiscountConverted > 0 ? 'success' : 'default'}
        data-testid="metric-avg-discount-converted"
      />
    </div>
  );
}
