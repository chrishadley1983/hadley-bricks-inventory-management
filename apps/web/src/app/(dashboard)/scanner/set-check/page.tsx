'use client';

import dynamic from 'next/dynamic';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { usePerfPage } from '@/hooks';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

const SetCheckSessionsTable = dynamic(
  () =>
    import('@/components/features/scanner').then((mod) => ({
      default: mod.SetCheckSessionsTable,
    })),
  { ssr: false, loading: () => <TableSkeleton columns={6} rows={10} /> }
);

export default function SetCheckPage() {
  usePerfPage('SetCheckPage');

  return (
    <>
      <Header title="Set Check" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Set Check Sessions</h2>
          <p className="text-muted-foreground">
            View completeness checks for LEGO sets scanned with the conveyor belt
          </p>
        </div>

        <SetCheckSessionsTable />
      </div>
    </>
  );
}
