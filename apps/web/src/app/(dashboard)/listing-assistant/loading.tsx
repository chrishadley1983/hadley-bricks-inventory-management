import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6 space-y-4">
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-32 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
        <TableSkeleton columns={4} rows={5} />
      </div>
    </>
  );
}
