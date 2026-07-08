import { Skeleton } from '@/components/ui/skeleton';
import { StatCardSkeleton, TableSkeleton, PageTitleSkeleton } from '@/components/ui/skeletons';

export default function BrickRadarLoading() {
  return (
    <div className="space-y-6 p-6">
      <PageTitleSkeleton />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      <Skeleton className="h-96 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TableSkeleton columns={7} rows={6} showSearch showPagination={false} />
        <TableSkeleton columns={8} rows={6} showSearch showPagination={false} />
      </div>

      <Skeleton className="h-72 w-full rounded-lg" />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>

      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}
