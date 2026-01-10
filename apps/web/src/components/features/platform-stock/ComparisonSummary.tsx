'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  AlertTriangle,
  Package,
  ShoppingCart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  ComparisonSummary as ComparisonSummaryType,
  DiscrepancyType,
} from '@/lib/platform-stock';

interface ComparisonSummaryProps {
  summary: ComparisonSummaryType | null;
  isLoading?: boolean;
  activeFilter?: DiscrepancyType | 'all';
  onFilterClick?: (filter: DiscrepancyType | 'all') => void;
}

interface SummaryCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  isActive?: boolean;
  onClick?: () => void;
}

function SummaryCard({
  title,
  value,
  icon,
  description,
  variant = 'default',
  isActive = false,
  onClick,
}: SummaryCardProps) {
  const variantClasses = {
    default: '',
    success: 'border-green-200 bg-green-50/50 dark:bg-green-950/20',
    warning: 'border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20',
    error: 'border-red-200 bg-red-50/50 dark:bg-red-950/20',
    info: 'border-blue-200 bg-blue-50/50 dark:bg-blue-950/20',
  };

  return (
    <Card
      className={cn(
        variantClasses[variant],
        onClick && 'cursor-pointer transition-all hover:shadow-md',
        isActive && 'ring-2 ring-primary ring-offset-2'
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {new Intl.NumberFormat('en-GB').format(value)}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-5 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-32 mt-2" />
      </CardContent>
    </Card>
  );
}

export function ComparisonSummary({
  summary,
  isLoading = false,
  activeFilter,
  onFilterClick,
}: ComparisonSummaryProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SummaryCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const handleClick = (filter: DiscrepancyType | 'all') => {
    if (onFilterClick) {
      // Toggle: if clicking the active filter, clear it (set to 'all')
      if (activeFilter === filter) {
        onFilterClick('all');
      } else {
        onFilterClick(filter);
      }
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <SummaryCard
        title="Platform Listings"
        value={summary.totalPlatformListings}
        icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />}
        description={`${summary.totalPlatformQuantity} total qty`}
      />

      <SummaryCard
        title="Inventory Items"
        value={summary.totalInventoryItems}
        icon={<Package className="h-4 w-4 text-muted-foreground" />}
        description="Items in database"
      />

      <SummaryCard
        title="Matched"
        value={summary.matchedItems}
        icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
        description="Qty matches"
        variant="success"
        isActive={activeFilter === 'match'}
        onClick={() => handleClick('match')}
      />

      <SummaryCard
        title="Platform Only"
        value={summary.platformOnlyItems}
        icon={<AlertCircle className="h-4 w-4 text-orange-600" />}
        description="Not in inventory"
        variant="warning"
        isActive={activeFilter === 'platform_only'}
        onClick={() => handleClick('platform_only')}
      />

      <SummaryCard
        title="Inventory Only"
        value={summary.inventoryOnlyItems}
        icon={<XCircle className="h-4 w-4 text-red-600" />}
        description="Not on platform"
        variant="error"
        isActive={activeFilter === 'inventory_only'}
        onClick={() => handleClick('inventory_only')}
      />

      <SummaryCard
        title="Qty Mismatch"
        value={summary.quantityMismatches}
        icon={<AlertTriangle className="h-4 w-4 text-yellow-600" />}
        description="Quantities differ"
        variant="warning"
        isActive={activeFilter === 'quantity_mismatch'}
        onClick={() => handleClick('quantity_mismatch')}
      />
    </div>
  );
}
