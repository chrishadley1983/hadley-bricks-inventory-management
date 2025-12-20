'use client';

import dynamic from 'next/dynamic';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamically import widgets to prevent SSR issues
const InventorySummaryWidget = dynamic(
  () =>
    import('@/components/features/dashboard').then((mod) => ({
      default: mod.InventorySummaryWidget,
    })),
  { ssr: false }
);

const FinancialSnapshotWidget = dynamic(
  () =>
    import('@/components/features/dashboard').then((mod) => ({
      default: mod.FinancialSnapshotWidget,
    })),
  { ssr: false }
);

const StatusBreakdownWidget = dynamic(
  () =>
    import('@/components/features/dashboard').then((mod) => ({
      default: mod.StatusBreakdownWidget,
    })),
  { ssr: false }
);

const RecentActivityWidget = dynamic(
  () =>
    import('@/components/features/dashboard').then((mod) => ({
      default: mod.RecentActivityWidget,
    })),
  { ssr: false }
);

const LowStockWidget = dynamic(
  () => import('@/components/features/dashboard').then((mod) => ({ default: mod.LowStockWidget })),
  { ssr: false }
);

export default function DashboardPage() {
  return (
    <>
      <Header title="Dashboard" />
      <div className="p-6">
        {/* Top stat widgets */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <InventorySummaryWidget />
          <FinancialSnapshotWidget />
          <div className="md:col-span-2">
            <StatusBreakdownWidget />
          </div>
        </div>

        {/* Bottom widgets */}
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <RecentActivityWidget />
          <LowStockWidget />
        </div>
      </div>
    </>
  );
}
