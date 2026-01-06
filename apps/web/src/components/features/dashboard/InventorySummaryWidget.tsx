'use client';

import { Package } from 'lucide-react';
import { StatWidget } from '@/components/ui/widget';
import { useInventorySummary } from '@/hooks';
import { useDashboardStore } from '@/stores';

/**
 * Widget displaying total inventory count
 */
export function InventorySummaryWidget() {
  const excludeSold = useDashboardStore((state) => state.excludeSold);
  const platform = useDashboardStore((state) => state.platform);
  const { data, isLoading, error } = useInventorySummary({ excludeSold, platform });

  const backlogCount = data?.byStatus?.['BACKLOG'] || 0;
  const totalItems = data?.totalItems || 0;

  return (
    <StatWidget
      title="Total Inventory"
      value={totalItems}
      subtitle={`${backlogCount} in backlog`}
      icon={<Package className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
    />
  );
}
