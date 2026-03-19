'use client';

import dynamic from 'next/dynamic';
import { HeaderSkeleton, WidgetCardSkeleton } from '@/components/ui/skeletons';
import { usePerfPage } from '@/hooks';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

// Dynamically import LiveScannerDashboard to prevent SSR issues
const LiveScannerDashboard = dynamic(
  () =>
    import('@/components/features/scanner').then((mod) => ({
      default: mod.LiveScannerDashboard,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <WidgetCardSkeleton lines={1} showIcon={false} />
        <WidgetCardSkeleton lines={4} showIcon={false} />
        <WidgetCardSkeleton lines={4} showIcon={false} />
      </div>
    ),
  }
);

export default function ScannerLivePage() {
  usePerfPage('ScannerLivePage');

  return (
    <>
      <Header title="Live Scanner" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Live Dashboard</h2>
          <p className="text-muted-foreground">
            Real-time view of the active scan session
          </p>
        </div>

        <LiveScannerDashboard />
      </div>
    </>
  );
}
