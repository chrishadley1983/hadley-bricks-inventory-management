'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { usePerfPage } from '@/hooks/use-perf';

// Dynamic import for Header to avoid SSR issues
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamic import for SeededAsinManager
const SeededAsinManager = dynamic(
  () =>
    import('@/components/features/arbitrage').then((mod) => ({
      default: mod.SeededAsinManager,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    ),
  }
);

export default function SeededAsinsPage() {
  usePerfPage('SeededAsinsPage');
  return (
    <div className="flex flex-col h-full">
      <Header
        title="Seeded ASIN Discovery"
        description="Discover and manage ASINs from Brickset database for arbitrage tracking"
      />
      <main className="flex-1 p-6 overflow-auto">
        <SeededAsinManager />
      </main>
    </div>
  );
}
