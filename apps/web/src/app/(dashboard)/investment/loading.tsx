import { HeaderSkeleton, DashboardSkeleton } from '@/components/ui/skeletons';

export default function InvestmentLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6">
        <DashboardSkeleton />
      </div>
    </>
  );
}
