'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const MinifigSyncTabs = dynamic(
  () =>
    import('@/components/features/minifig-sync/MinifigSyncTabs').then((mod) => ({
      default: mod.MinifigSyncTabs,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <Skeleton className="h-10 w-96" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    ),
  }
);

export default function MinifigSyncPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Minifig Sync</h1>
        <p className="text-muted-foreground">Manage minifigure inventory and eBay listings</p>
      </div>
      <MinifigSyncTabs />
    </div>
  );
}
