'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { HeaderSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () => import('@/components/layout/Header').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const TopPicksSkeleton = () => (
  <div className="space-y-4">
    <div className="flex gap-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-9 w-24 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-lg border bg-muted" />
      ))}
    </div>
  </div>
);

const TopPicksContent = dynamic(
  () => import('@/components/features/investment/TopPicks').then((mod) => ({ default: mod.TopPicks })),
  { ssr: false, loading: () => <TopPicksSkeleton /> }
);

export default function TopPicksPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <Header
        title="Top Investment Picks"
        description="Highest-scored LEGO sets for investment potential"
      />
      <TopPicksContent />
    </div>
  );
}
