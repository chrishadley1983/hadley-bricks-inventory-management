import { HeaderSkeleton, WidgetCardSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function IntegrationsLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>

        {/* Integration cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <WidgetCardSkeleton lines={4} />
          <WidgetCardSkeleton lines={4} />
          <WidgetCardSkeleton lines={4} />
          <WidgetCardSkeleton lines={4} />
          <WidgetCardSkeleton lines={4} />
        </div>
      </div>
    </>
  );
}
