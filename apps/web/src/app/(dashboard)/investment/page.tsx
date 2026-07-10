'use client';

import dynamic from 'next/dynamic';
import { HeaderSkeleton, DashboardSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const InvestmentDashboard = dynamic(
  () =>
    import('@/components/features/investment').then((mod) => ({
      default: mod.InvestmentDashboard,
    })),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

export default function InvestmentPage() {
  return (
    <>
      <Header title="Investment" />
      <div className="p-6">
        <InvestmentDashboard />
      </div>
    </>
  );
}
