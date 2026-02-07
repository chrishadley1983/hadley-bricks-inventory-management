import { HeaderSkeleton, PageTitleSkeleton, TableSkeleton } from '@/components/ui/skeletons';

export default function InvestmentLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6">
        <PageTitleSkeleton />
        <TableSkeleton columns={8} rows={10} />
      </div>
    </>
  );
}
