import { TableSkeleton } from '@/components/ui/skeletons';

export default function Loading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header placeholder */}
      <div className="h-8 w-48 bg-muted rounded animate-pulse" />

      {/* Description placeholder */}
      <div className="h-4 w-96 bg-muted rounded animate-pulse" />

      {/* Filters placeholder */}
      <div className="flex gap-4 p-4 border rounded-lg">
        <div className="h-10 w-64 bg-muted rounded animate-pulse" />
        <div className="h-10 w-24 bg-muted rounded animate-pulse" />
        <div className="h-10 w-32 bg-muted rounded animate-pulse" />
        <div className="h-10 w-20 bg-muted rounded animate-pulse" />
        <div className="ml-auto h-10 w-24 bg-muted rounded animate-pulse" />
      </div>

      {/* Table skeleton */}
      <TableSkeleton rows={10} columns={8} />
    </div>
  );
}
