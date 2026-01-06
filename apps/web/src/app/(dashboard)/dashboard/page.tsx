'use client';

import dynamic from 'next/dynamic';
import { useDashboardStore } from '@/stores';
import { usePlatforms } from '@/hooks';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamically import widgets to prevent SSR issues
const BricqerInventoryWidget = dynamic(
  () =>
    import('@/components/features/dashboard').then((mod) => ({
      default: mod.BricqerInventoryWidget,
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
  const excludeSold = useDashboardStore((state) => state.excludeSold);
  const toggleExcludeSold = useDashboardStore((state) => state.toggleExcludeSold);
  const platform = useDashboardStore((state) => state.platform);
  const setPlatform = useDashboardStore((state) => state.setPlatform);
  const { data: platforms = [] } = usePlatforms();

  return (
    <>
      <Header title="Dashboard" />
      <div className="p-6">
        {/* Dashboard Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-end gap-4">
          {/* Platform Filter */}
          <div className="flex items-center gap-2">
            <Label htmlFor="platform-filter" className="text-sm text-muted-foreground">
              Platform:
            </Label>
            <Select
              value={platform || 'all'}
              onValueChange={(value: string) => setPlatform(value === 'all' ? null : value)}
            >
              <SelectTrigger id="platform-filter" className="w-[160px]">
                <SelectValue placeholder="All Platforms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                {platforms.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Exclude Sold Toggle */}
          <div className="flex items-center gap-2">
            <Switch id="exclude-sold" checked={excludeSold} onCheckedChange={toggleExcludeSold} />
            <Label htmlFor="exclude-sold" className="text-sm text-muted-foreground cursor-pointer">
              Exclude sold items
            </Label>
          </div>
        </div>

        {/* Top stat widgets */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <BricqerInventoryWidget />
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
