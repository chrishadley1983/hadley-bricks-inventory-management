'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { TableSkeleton } from '@/components/ui/skeletons';

const MinifigItemsTable = dynamic(
  () =>
    import('@/components/features/minifig-sync').then((mod) => ({
      default: mod.MinifigItemsTable,
    })),
  {
    ssr: false,
    loading: () => <TableSkeleton />,
  },
);

export default function MinifigItemsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Minifig Items</h1>
        <p className="text-muted-foreground">
          Browse all minifigures synced from Bricqer
        </p>
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <MinifigItemsTable />
      </Suspense>
    </div>
  );
}
