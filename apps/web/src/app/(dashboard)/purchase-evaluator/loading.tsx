import { HeaderSkeleton, PageTitleSkeleton, TableSkeleton } from '@/components/ui/skeletons';

export default function PurchaseEvaluatorLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6">
        <PageTitleSkeleton />
        <TableSkeleton columns={6} rows={5} />
      </div>
    </>
  );
}
