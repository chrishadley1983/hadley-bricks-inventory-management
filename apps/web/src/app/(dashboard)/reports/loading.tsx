import { HeaderSkeleton, WidgetCardSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReportsLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6 space-y-6">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-36" />
          </div>
        </div>

        {/* Report Cards Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <WidgetCardSkeleton lines={3} />
          <WidgetCardSkeleton lines={3} />
          <WidgetCardSkeleton lines={3} />
          <WidgetCardSkeleton lines={3} />
          <WidgetCardSkeleton lines={3} />
          <WidgetCardSkeleton lines={3} />
        </div>
      </div>
    </>
  );
}
