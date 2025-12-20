'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamically import InventoryDetail to prevent SSR issues
const InventoryDetail = dynamic(
  () =>
    import('@/components/features/inventory/InventoryDetail').then((mod) => ({
      default: mod.InventoryDetail,
    })),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function InventoryDetailPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <>
      <Header title="Inventory Item" />
      <div className="p-6">
        <InventoryDetail id={id} />
      </div>
    </>
  );
}
