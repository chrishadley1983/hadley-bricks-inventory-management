'use client';

import { Package } from 'lucide-react';
import { StatWidget } from '@/components/ui/widget';
import { useInventorySummary } from '@/hooks';

/**
 * Widget displaying total inventory count
 */
export function InventorySummaryWidget() {
  const { data, isLoading, error } = useInventorySummary();

  const inStockCount = data?.byStatus?.['IN STOCK'] || 0;
  const totalItems = data?.totalItems || 0;

  return (
    <StatWidget
      title="Total Inventory"
      value={totalItems}
      subtitle={`${inStockCount} in stock`}
      icon={<Package className="h-4 w-4" />}
      isLoading={isLoading}
      error={error instanceof Error ? error : null}
    />
  );
}
