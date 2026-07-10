'use client';

import dynamic from 'next/dynamic';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () => import('@/components/layout/Header').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const TopPicksDealSheet = dynamic(
  () =>
    import('@/components/features/investment').then((mod) => ({
      default: mod.TopPicksDealSheet,
    })),
  { ssr: false, loading: () => <TableSkeleton columns={9} rows={10} /> }
);

export default function TopPicksPage() {
  return (
    <>
      <Header title="Top Picks" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Top picks deal sheet</h2>
          <p className="text-muted-foreground">
            Ranked by model score, with the recommended max buy price and the reasoning behind each
            pick
          </p>
        </div>

        <TopPicksDealSheet />
      </div>
    </>
  );
}
