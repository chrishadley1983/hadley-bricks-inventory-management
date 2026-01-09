'use client';

import dynamic from 'next/dynamic';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamically import InventoryAddTabs to prevent SSR issues
const InventoryAddTabs = dynamic(
  () =>
    import('@/components/features/inventory/InventoryAddTabs').then((mod) => ({
      default: mod.InventoryAddTabs,
    })),
  { ssr: false }
);

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
