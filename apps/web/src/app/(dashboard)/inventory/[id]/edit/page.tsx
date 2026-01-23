'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import { usePerfPage } from '@/hooks/use-perf';

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

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditInventoryPage({ params }: PageProps) {
  usePerfPage('EditInventoryPage');
  const { id } = use(params);

  return (
    <>
      <Header title="Edit Inventory Item" />
      <div className="p-6">
        <InventoryForm mode="edit" itemId={id} />
      </div>
    </>
  );
}
