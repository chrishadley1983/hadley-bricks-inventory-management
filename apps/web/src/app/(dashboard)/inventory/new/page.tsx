'use client';

import { Header } from '@/components/layout';
import { InventoryAddTabs } from '@/components/features/inventory/InventoryAddTabs';

export default function NewInventoryPage() {
  return (
    <>
      <Header title="Add Inventory" />
      <div className="p-6">
        <InventoryAddTabs />
      </div>
    </>
  );
}
