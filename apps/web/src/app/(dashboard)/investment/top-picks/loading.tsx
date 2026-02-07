import { HeaderSkeleton, WidgetCardSkeleton } from '@/components/ui/skeletons';

export default function TopPicksLoading() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <HeaderSkeleton />
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <WidgetCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
