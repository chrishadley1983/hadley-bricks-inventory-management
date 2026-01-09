import { HeaderSkeleton, WidgetCardSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function OrdersLoading() {
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
            <Skeleton className="h-10 w-40" />
          </div>
        </div>

        {/* Status Summary Cards */}
        <div className="grid gap-4 md:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <WidgetCardSkeleton key={i} lines={1} showIcon={false} />
          ))}
        </div>

        {/* Platform Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <WidgetCardSkeleton lines={5} />
          <WidgetCardSkeleton lines={5} />
          <WidgetCardSkeleton lines={5} />
        </div>

        {/* Orders Table */}
        <TableSkeleton columns={8} rows={8} />
      </div>
    </>
  );
}
