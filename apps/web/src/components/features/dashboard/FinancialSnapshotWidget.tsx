'use client';

import { TrendingUp } from 'lucide-react';
import { StatWidget } from '@/components/ui/widget';
import { useInventorySummary } from '@/hooks';
import { formatCurrency } from '@/lib/utils';

/**
 * Widget displaying financial overview (total cost and listing value)
 */
export function FinancialSnapshotWidget() {
  const { data, isLoading, error } = useInventorySummary();

  const totalCost = data?.totalCost || 0;
  const totalListingValue = data?.totalListingValue || 0;
  const potentialProfit = totalListingValue - totalCost;

  return (
    <StatWidget
      title="Inventory Value"
      value={formatCurrency(totalCost)}
      subtitle={`Listing value: ${formatCurrency(totalListingValue)}`}
      icon={<TrendingUp className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
      trend={
        totalCost > 0
          ? {
              value: Math.round((potentialProfit / totalCost) * 100),
              isPositive: potentialProfit > 0,
            }
          : undefined
      }
    />
  );
}
