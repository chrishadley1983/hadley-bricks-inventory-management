'use client';

import dynamic from 'next/dynamic';
import { HeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { usePerfPage } from '@/hooks';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

// Dynamically import ScannerSessionsTable to prevent SSR issues
const ScannerSessionsTable = dynamic(
  () =>
    import('@/components/features/scanner').then((mod) => ({
      default: mod.ScannerSessionsTable,
    })),
  { ssr: false, loading: () => <TableSkeleton columns={8} rows={10} /> }
);

export default function ScannerPage() {
  usePerfPage('ScannerPage');

  return (
    <>
      <Header title="Scanner" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Scan Sessions</h2>
          <p className="text-muted-foreground">View and manage LEGO piece scan sessions</p>
        </div>

        <ScannerSessionsTable />
      </div>
    </>
  );
}
