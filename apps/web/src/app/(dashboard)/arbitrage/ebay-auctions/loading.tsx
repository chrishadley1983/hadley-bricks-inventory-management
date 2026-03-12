import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <Skeleton className="h-10 w-80" />
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
