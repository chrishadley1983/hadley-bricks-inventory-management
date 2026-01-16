import { HeaderSkeleton, PageTitleSkeleton, TableSkeleton } from '@/components/ui/skeletons';

export default function AmazonOrdersLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6">
        <PageTitleSkeleton />
        <TableSkeleton columns={7} rows={10} />
      </div>
    </>
  );
}
