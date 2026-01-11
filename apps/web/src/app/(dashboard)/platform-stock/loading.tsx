import { TableSkeleton, HeaderSkeleton, WidgetCardSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function PlatformStockLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6 space-y-6">
        {/* Page header skeleton */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>

        {/* Tabs skeleton */}
        <Skeleton className="h-10 w-full max-w-md" />

        {/* Summary cards skeleton */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <WidgetCardSkeleton key={i} />
          ))}
        </div>

        {/* Table skeleton */}
        <TableSkeleton columns={7} rows={10} showSearch showPagination />
      </div>
    </>
  );
}
