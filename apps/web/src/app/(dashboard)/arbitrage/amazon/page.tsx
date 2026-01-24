'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, CheckCircle2, EyeOff, Link2Off, Clock, CalendarClock } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArbitrageFilters,
  ArbitrageTable,
  ArbitrageDetailModal,
  ExcludedAsinsModal,
  UnmappedAsinsTable,
} from '@/components/features/arbitrage';
import {
  useArbitrageData,
  useArbitrageItem,
  useSyncStatus,
  useArbitrageSummary,
  useExcludeAsin,
} from '@/hooks/use-arbitrage';
import type { ArbitrageFilterOptions, ArbitrageItem } from '@/lib/arbitrage/types';
import { useToast } from '@/hooks/use-toast';

// Dynamic import for Header to avoid SSR issues
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

type TabValue = 'opportunities' | 'unmapped' | 'settings';

export default function AmazonArbitragePage() {
  usePerfPage('AmazonArbitragePage');
  const [activeTab, setActiveTab] = useState<TabValue>('opportunities');
  const [filters, setFilters] = useState<ArbitrageFilterOptions>({});
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [excludedModalOpen, setExcludedModalOpen] = useState(false);
  const { toast } = useToast();

  // Data hooks
  const { data: arbitrageData, isLoading: dataLoading, error: dataError } = useArbitrageData(filters);
  const { data: selectedItem } = useArbitrageItem(selectedAsin);
  const { data: syncStatus, isLoading: syncLoading } = useSyncStatus();
  const { data: summary, isLoading: summaryLoading } = useArbitrageSummary();

  // Mutations
  const excludeMutation = useExcludeAsin();

  const handleFiltersChange = useCallback((newFilters: ArbitrageFilterOptions) => {
    setFilters(newFilters);
  }, []);

  const handleRowClick = useCallback((item: ArbitrageItem) => {
    setSelectedAsin(item.asin);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedAsin(null);
  }, []);

  const handleExclude = useCallback(async (asin: string, reason?: string) => {
    try {
      await excludeMutation.mutateAsync({ asin, reason });
      toast({ title: 'ASIN excluded from tracking' });
      setSelectedAsin(null);
    } catch {
      toast({ title: 'Failed to exclude ASIN', variant: 'destructive' });
    }
  }, [excludeMutation, toast]);

  // Extract items from response
  const items = arbitrageData?.items ?? [];
  const totalCount = arbitrageData?.totalCount ?? 0;
  const opportunityCount = arbitrageData?.opportunityCount ?? 0;

  return (
    <>
      <Header title="Arbitrage Tracker - Amazon" />
      <div className="p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {summaryLoading ? (
            <>
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
            </>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Tracked</CardDescription>
                  <CardTitle className="text-2xl">{summary?.totalItems ?? 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    ASINs with pricing data
                  </p>
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
                <CardHeader className="pb-2">
                  <CardDescription>Opportunities</CardDescription>
                  <CardTitle className="text-2xl text-green-600 dark:text-green-400">
                    {summary?.opportunities ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    &ge;20% margin potential
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Unmapped</CardDescription>
                  <CardTitle className="text-2xl text-amber-600 dark:text-amber-400">
                    {summary?.unmapped ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Need manual linking
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Excluded</CardDescription>
                  <CardTitle className="text-2xl">{summary?.excluded ?? 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="link"
                    className="p-0 h-auto text-xs"
                    onClick={() => setExcludedModalOpen(true)}
                  >
                    Manage excluded ASINs
                  </Button>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Sync Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" />
                  Sync Status
                </CardTitle>
                <CardDescription>Data is automatically synced daily. 1,000 items per platform per day.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {syncLoading ? (
              <div className="flex gap-4">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-10 w-48" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-4">
                <SyncStatusBadge
                  label="Amazon Inventory"
                  lastSync={syncStatus?.syncStatus?.inventory_asins?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.inventory_asins?.status}
                />
                <SyncStatusBadge
                  label="Amazon Pricing"
                  lastSync={syncStatus?.syncStatus?.amazon_pricing?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.amazon_pricing?.status}
                  schedule="4:00am"
                />
                <SyncStatusBadge
                  label="BrickLink"
                  lastSync={syncStatus?.syncStatus?.bricklink_pricing?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.bricklink_pricing?.status}
                  schedule="2:30am"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Alert */}
        {dataError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error loading arbitrage data</AlertTitle>
            <AlertDescription>
              {dataError instanceof Error ? dataError.message : 'Failed to load data'}
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v: string) => setActiveTab(v as TabValue)}
        >
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="opportunities">
              Opportunities
              {opportunityCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {opportunityCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="unmapped">
              Unmapped
              {(summary?.unmapped ?? 0) > 0 && (
                <Badge variant="outline" className="ml-2 text-amber-600">
                  {summary?.unmapped}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="opportunities" className="mt-6 space-y-4">
            <ArbitrageFilters
              filters={filters}
              onFiltersChange={handleFiltersChange}
              totalItems={totalCount}
              opportunities={opportunityCount}
              unmappedCount={summary?.unmapped ?? 0}
              onOpenExcluded={() => setExcludedModalOpen(true)}
            />
            <ArbitrageTable
              items={items}
              isLoading={dataLoading}
              minMargin={filters.minMargin ?? 30}
              onRowClick={handleRowClick}
            />
          </TabsContent>

          <TabsContent value="unmapped" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2Off className="h-5 w-5" />
                  Unmapped ASINs
                </CardTitle>
                <CardDescription>
                  These Amazon products couldn&apos;t be automatically matched to BrickLink sets.
                  Search BrickLink and manually map them to enable arbitrage comparison.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UnmappedAsinsTable />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <EyeOff className="h-5 w-5" />
                  Excluded ASINs
                </CardTitle>
                <CardDescription>
                  ASINs you&apos;ve excluded from arbitrage tracking. You can restore them anytime.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => setExcludedModalOpen(true)}>
                  Manage Excluded ASINs ({summary?.excluded ?? 0})
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5" />
                  Automated Sync Schedule
                </CardTitle>
                <CardDescription>
                  Pricing data is automatically synced on a daily schedule. Each sync processes up to 1,000 items, completing a full cycle of all watchlist items in ~3 days.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b">
                  <div>
                    <span className="text-sm font-medium">eBay Pricing</span>
                    <p className="text-xs text-muted-foreground">1,000 items/day</p>
                  </div>
                  <span className="text-sm text-muted-foreground">Daily at 2:00am UTC</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <div>
                    <span className="text-sm font-medium">BrickLink Pricing</span>
                    <p className="text-xs text-muted-foreground">1,000 items/day</p>
                  </div>
                  <span className="text-sm text-muted-foreground">Daily at 2:30am UTC</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <div>
                    <span className="text-sm font-medium">Amazon Pricing</span>
                    <p className="text-xs text-muted-foreground">Seeded ASINs</p>
                  </div>
                  <span className="text-sm text-muted-foreground">Daily at 4:00am UTC</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm font-medium">Full Sync Cycle</span>
                    <p className="text-xs text-muted-foreground">All watchlist items</p>
                  </div>
                  <span className="text-sm text-muted-foreground">~3 days</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Detail Modal */}
        <ArbitrageDetailModal
          item={selectedItem ?? null}
          isOpen={!!selectedAsin}
          onClose={handleCloseDetail}
          onExclude={handleExclude}
        />

        {/* Excluded ASINs Modal */}
        <ExcludedAsinsModal
          isOpen={excludedModalOpen}
          onClose={() => setExcludedModalOpen(false)}
        />
      </div>
    </>
  );
}

// Read-only Sync Status Badge (scheduled syncs - no manual trigger)
function SyncStatusBadge({
  label,
  lastSync,
  status,
  schedule,
}: {
  label: string;
  lastSync: string | null | undefined;
  status: string | null | undefined;
  schedule?: string;
}) {
  const isStale = !lastSync || (Date.now() - new Date(lastSync).getTime()) > 3 * 24 * 60 * 60 * 1000; // 3 days
  const isRecent = lastSync && (Date.now() - new Date(lastSync).getTime()) < 24 * 60 * 60 * 1000; // < 1 day
  const isError = status === 'failed';

  const formatRelativeTime = (date: string | null | undefined) => {
    if (!date) return 'Never synced';
    const diff = Date.now() - new Date(date).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  };

  const getStalenessColor = () => {
    if (isError) return 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20';
    if (isStale) return 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20';
    if (isRecent) return 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20';
    return '';
  };

  return (
    <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${getStalenessColor()}`}>
      {isError ? (
        <AlertCircle className="h-4 w-4 text-destructive" />
      ) : isStale ? (
        <Clock className="h-4 w-4 text-amber-500" />
      ) : (
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      )}
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(lastSync)}
          {schedule && <span className="ml-1">• {schedule}</span>}
        </span>
      </div>
    </div>
  );
}

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-16 mt-1" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}
