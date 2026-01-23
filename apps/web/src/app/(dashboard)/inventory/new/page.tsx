'use client';

import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/layout';
import { InventoryAddTabs } from '@/components/features/inventory/InventoryAddTabs';
import { usePerfPage } from '@/hooks/use-perf';

export default function NewInventoryPage() {
  usePerfPage('NewInventoryPage');
  const searchParams = useSearchParams();
  const purchaseId = searchParams.get('purchaseId');

  return (
    <>
      <Header title="Add Inventory" />
      <div className="p-6">
        <InventoryAddTabs initialPurchaseId={purchaseId} />
      </div>
    </>
  );
}
