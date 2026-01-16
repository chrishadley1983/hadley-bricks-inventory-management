import { HeaderSkeleton, WidgetCardSkeleton, StatCardSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>

        {/* Stats row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>

        {/* Charts row */}
        <div className="grid gap-4 md:grid-cols-2">
          <WidgetCardSkeleton lines={8} />
          <WidgetCardSkeleton lines={8} />
        </div>

        {/* Recent activity */}
        <WidgetCardSkeleton lines={5} />
      </div>
    </>
  );
}
