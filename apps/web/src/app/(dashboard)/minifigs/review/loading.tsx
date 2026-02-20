import { Skeleton } from '@/components/ui/skeleton';

export default function MinifigReviewLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-80 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
