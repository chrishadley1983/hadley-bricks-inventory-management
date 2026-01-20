'use client';

import { OrdersDispatchPanel } from './OrdersDispatchPanel';
import { InventoryResolutionCard } from './InventoryResolutionCard';
import { PlatformSyncStatusGrid } from './PlatformSyncStatusGrid';

interface CriticalActionsPanelProps {
  className?: string;
}

export function CriticalActionsPanel({ className }: CriticalActionsPanelProps) {
  return (
    <div className={className}>
      <h2 className="text-lg font-semibold mb-4">Critical Actions</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {/* Orders to Dispatch - takes full width on mobile, 2 cols on desktop */}
        <div className="md:col-span-2">
          <OrdersDispatchPanel className="h-full" />
        </div>

        {/* Right column - Resolution and Sync */}
        <div className="space-y-4">
          <InventoryResolutionCard />
          <PlatformSyncStatusGrid />
        </div>
      </div>
    </div>
  );
}
