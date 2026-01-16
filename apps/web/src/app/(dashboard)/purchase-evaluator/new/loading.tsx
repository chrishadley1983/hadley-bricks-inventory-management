import { HeaderSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function NewPurchaseEvaluatorLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6 space-y-6">
        {/* Back link and title */}
        <div>
          <Skeleton className="h-4 w-40 mb-4" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-4 mb-6">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-16" />
        </div>

        {/* Form content */}
        <div className="space-y-4">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </>
  );
}
