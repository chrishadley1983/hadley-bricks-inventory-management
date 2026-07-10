'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import type { InvestmentFilters } from '@/lib/api/investment';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const InvestmentTable = dynamic(
  () =>
    import('@/components/features/investment').then((mod) => ({ default: mod.InvestmentTable })),
  { ssr: false, loading: () => <TableSkeleton columns={8} rows={10} /> }
);

function SetsBrowser() {
  const searchParams = useSearchParams();

  // Dashboard sections deep-link here with a pre-applied filter
  const initialFilters: InvestmentFilters = {};
  const retiringWithin = searchParams.get('retiringWithinMonths');
  if (retiringWithin && !Number.isNaN(Number(retiringWithin))) {
    initialFilters.retiringWithinMonths = Number(retiringWithin);
  }
  const status = searchParams.get('retirementStatus');
  if (status === 'available' || status === 'retiring_soon' || status === 'retired') {
    initialFilters.retirementStatus = status;
  }
  const theme = searchParams.get('theme');
  if (theme) {
    initialFilters.theme = theme;
  }

  return <InvestmentTable initialFilters={initialFilters} />;
}

export default function InvestmentSetsPage() {
  return (
    <>
      <Header title="Browse All Sets" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Browse all sets</h2>
          <p className="text-muted-foreground">
            Every tracked LEGO set with retirement data, Amazon pricing and model scores
          </p>
        </div>

        <Suspense fallback={<TableSkeleton columns={8} rows={10} />}>
          <SetsBrowser />
        </Suspense>
      </div>
    </>
  );
}
