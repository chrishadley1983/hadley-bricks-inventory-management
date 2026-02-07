import { HeaderSkeleton, StatCardSkeleton, WidgetCardSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function InvestmentSetDetailLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6 space-y-6">
        {/* Title */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-16 w-16 rounded-lg" />
        </div>

        {/* Quick stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>

        {/* Details grid */}
        <div className="grid gap-6 md:grid-cols-2">
          <WidgetCardSkeleton lines={6} />
          <WidgetCardSkeleton lines={5} />
          <WidgetCardSkeleton lines={6} />
          <WidgetCardSkeleton lines={4} />
        </div>

        {/* Chart */}
        <WidgetCardSkeleton lines={8} />
      </div>
    </>
  );
}
