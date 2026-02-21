'use client';

import dynamic from 'next/dynamic';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const InvestmentTable = dynamic(
  () =>
    import('@/components/features/investment').then((mod) => ({ default: mod.InvestmentTable })),
  { ssr: false, loading: () => <TableSkeleton columns={8} rows={10} /> }
);

export default function InvestmentPage() {
  return (
    <>
      <Header title="Investment Tracker" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">LEGO Investment Tracker</h2>
          <p className="text-muted-foreground">
            Track LEGO sets with retirement predictions and investment potential
          </p>
        </div>

        <InvestmentTable />
      </div>
    </>
  );
}
