'use client';

import dynamic from 'next/dynamic';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamically import InventoryForm to prevent SSR issues
const InventoryForm = dynamic(
  () =>
    import('@/components/features/inventory/InventoryForm').then((mod) => ({
      default: mod.InventoryForm,
    })),
  { ssr: false }
);

export default function NewInventoryPage() {
  return (
    <>
      <Header title="Add Inventory Item" />
      <div className="p-6">
        <InventoryForm mode="create" />
      </div>
    </>
  );
}
