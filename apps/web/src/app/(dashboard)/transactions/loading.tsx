import { HeaderSkeleton, PageTitleSkeleton, TableSkeleton } from '@/components/ui/skeletons';

export default function TransactionsLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6">
        <PageTitleSkeleton />
        <TableSkeleton columns={6} rows={10} />
      </div>
    </>
  );
}
