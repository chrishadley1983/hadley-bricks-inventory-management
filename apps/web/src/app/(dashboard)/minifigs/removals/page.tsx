'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const RemovalQueue = dynamic(
  () =>
    import('@/components/features/minifig-sync').then((mod) => ({
      default: mod.RemovalQueue,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      </div>
    ),
  },
);

export default function MinifigRemovalsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Removal Queue</h1>
        <p className="text-muted-foreground">
          Review cross-platform sales and approve listing removals
        </p>
      </div>
      <RemovalQueue />
    </div>
  );
}
