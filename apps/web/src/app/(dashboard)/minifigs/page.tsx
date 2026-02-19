'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const MinifigDashboard = dynamic(
  () =>
    import('@/components/features/minifig-sync').then((mod) => ({
      default: mod.MinifigDashboard,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    ),
  },
);

export default function MinifigSyncDashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Minifig Sync</h1>
        <p className="text-muted-foreground">
          Overview of the eBay minifig sync pipeline
        </p>
      </div>
      <MinifigDashboard />
    </div>
  );
}
