'use client';

import { useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AlertCircle, CheckCircle2, Clock, CalendarClock } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArbitrageFilters,
  ArbitrageTable,
  ArbitrageDetailModal,
  ExcludedAsinsModal,
} from '@/components/features/arbitrage';
import { EbayDetailModal } from '@/components/features/arbitrage/EbayDetailModal';
import {
  useArbitrageData,
  useArbitrageItem,
  useSyncStatus,
  useArbitrageSummary,
  useExcludeAsin,
} from '@/hooks/use-arbitrage';
import type { ArbitrageFilterOptions, ArbitrageItem, ArbitrageSortField } from '@/lib/arbitrage/types';
import {
  SHOW_FILTER_OPTIONS,
  EBAY_SHOW_FILTER_OPTIONS,
  SORT_OPTIONS,
  EBAY_SORT_OPTIONS,
} from '@/lib/arbitrage/types';
import { useToast } from '@/hooks/use-toast';

// Dynamic import for Header to avoid SSR issues
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamic import for SeededAsinManager
const SeededAsinManager = dynamic(
  () =>
    import('@/components/features/arbitrage').then((mod) => ({
      default: mod.SeededAsinManager,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    ),
  }
);

type MainTab = 'bricklink' | 'ebay' | 'seeded';

// Inner component that uses useSearchParams
function ArbitragePageContent() {
  usePerfPage('UnifiedArbitragePage');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  // Get tab from URL, default to 'bricklink'
  const activeTab = (searchParams.get('tab') as MainTab) || 'bricklink';

  // Modal states
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [excludedModalOpen, setExcludedModalOpen] = useState(false);

  // BrickLink filters (COG-based)
  const [blFilters, setBlFilters] = useState<ArbitrageFilterOptions>({
    show: 'opportunities',
    sortField: 'cog',
    sortDirection: 'asc',
    maxCog: 50,
    pageSize: 50,
    page: 1,
  });

  // eBay filters (COG-based)
  const [ebayFilters, setEbayFilters] = useState<ArbitrageFilterOptions>({
    show: 'ebay_opportunities',
    sortField: 'ebay_margin',
    sortDirection: 'asc',
    maxCog: 50,
    pageSize: 50,
    page: 1,
  });

  // Get current filters based on active tab
  const currentFilters = activeTab === 'bricklink' ? blFilters : ebayFilters;

  // Data hooks
  const { data: arbitrageData, isLoading: dataLoading, error: dataError } = useArbitrageData(
    activeTab !== 'seeded' ? currentFilters : undefined
  );
  const { data: selectedItem } = useArbitrageItem(selectedAsin);
  const { data: syncStatus, isLoading: syncLoading } = useSyncStatus();
  const { data: summary, isLoading: summaryLoading } = useArbitrageSummary(undefined, currentFilters.maxCog ?? 50);

  // Mutations
  const excludeMutation = useExcludeAsin();

  // Update URL when tab changes
  const handleTabChange = useCallback((tab: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    router.push(`/arbitrage?${params.toString()}`);
  }, [searchParams, router]);

  const handleBlFiltersChange = useCallback((newFilters: ArbitrageFilterOptions) => {
    setBlFilters((prev) => ({
      ...newFilters,
      page: newFilters.page !== prev.page ? newFilters.page : 1,
    }));
  }, []);

  const handleEbayFiltersChange = useCallback((newFilters: ArbitrageFilterOptions) => {
    setEbayFilters((prev) => ({
      ...newFilters,
      page: newFilters.page !== prev.page ? newFilters.page : 1,
    }));
  }, []);

  const handleRowClick = useCallback((item: ArbitrageItem) => {
    setSelectedAsin(item.asin);
  }, []);

  // Sort handlers for column header clicks
  const handleBlSort = useCallback((field: ArbitrageSortField) => {
    setBlFilters((prev) => ({
      ...prev,
      sortField: field,
      sortDirection: prev.sortField === field && prev.sortDirection === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
  }, []);

  const handleEbaySort = useCallback((field: ArbitrageSortField) => {
    setEbayFilters((prev) => ({
      ...prev,
      sortField: field,
      sortDirection: prev.sortField === field && prev.sortDirection === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
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

  // Extract data
  const items = arbitrageData?.items ?? [];
  const totalCount = arbitrageData?.totalCount ?? 0;
  const blOpportunityCount = summary?.opportunities ?? 0;
  const ebayOpportunityCount = summary?.ebayOpportunities ?? 0;

  // Get page title based on active tab
  const getPageTitle = () => {
    switch (activeTab) {
      case 'bricklink':
        return 'BrickLink → Amazon Arbitrage';
      case 'ebay':
        return 'eBay → Amazon Arbitrage';
      case 'seeded':
        return 'Seeded ASIN Discovery';
      default:
        return 'Arbitrage Tracker';
    }
  };

  return (
    <>
      <Header title={getPageTitle()} />
      <div className="p-6 space-y-6">
        {/* Main Tabs - BrickLink, eBay, Seeded */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="bricklink" className="flex items-center gap-2">
              BrickLink
              {blOpportunityCount > 0 && (
                <Badge variant="secondary" className="ml-1 font-mono">
                  {blOpportunityCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ebay" className="flex items-center gap-2">
              eBay
              {ebayOpportunityCount > 0 && (
                <Badge variant="secondary" className="ml-1 font-mono">
                  {ebayOpportunityCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="seeded">Seeded</TabsTrigger>
          </TabsList>

          {/* BrickLink Tab Content */}
          <TabsContent value="bricklink" className="mt-6 space-y-6">
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
                  <SummaryCard
                    label="Total Tracked"
                    value={summary?.totalItems ?? 0}
                    description="ASINs with pricing data"
                  />
                  <SummaryCard
                    label="Opportunities"
                    value={blOpportunityCount}
                    description={`≤${blFilters.maxCog ?? 50}% COG`}
                    variant="success"
                  />
                  <SummaryCard
                    label="Unmapped"
                    value={summary?.unmapped ?? 0}
                    description="Need manual linking"
                    variant="warning"
                  />
                  <SummaryCard
                    label="Excluded"
                    value={summary?.excluded ?? 0}
                    description="Manage excluded"
                    onClick={() => setExcludedModalOpen(true)}
                  />
                </>
              )}
            </div>

            {/* Sync Status */}
            <SyncStatusCard
              syncStatus={syncStatus?.syncStatus}
              isLoading={syncLoading}
              tab="bricklink"
            />

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

            {/* Filters and Table */}
            <ArbitrageFilters
              filters={blFilters}
              onFiltersChange={handleBlFiltersChange}
              totalItems={totalCount}
              opportunities={blOpportunityCount}
              unmappedCount={summary?.unmapped ?? 0}
              onOpenExcluded={() => setExcludedModalOpen(true)}
              showFilterOptions={SHOW_FILTER_OPTIONS}
              sortOptions={SORT_OPTIONS}
              defaultSortField="cog"
            />
            <ArbitrageTable
              items={items}
              isLoading={dataLoading}
              minMargin={100 - (blFilters.maxCog ?? 50)}
              maxCog={blFilters.maxCog ?? 50}
              onRowClick={handleRowClick}
              sortField={blFilters.sortField}
              sortDirection={blFilters.sortDirection}
              onSort={handleBlSort}
            />
          </TabsContent>

          {/* eBay Tab Content */}
          <TabsContent value="ebay" className="mt-6 space-y-6">
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
                  <SummaryCard
                    label="Total Tracked"
                    value={summary?.totalItems ?? 0}
                    description="ASINs with pricing data"
                  />
                  <SummaryCard
                    label="eBay Opportunities"
                    value={ebayOpportunityCount}
                    description={`≤${ebayFilters.maxCog ?? 50}% COG`}
                    variant="success"
                  />
                  <SummaryCard
                    label="Unmapped"
                    value={summary?.unmapped ?? 0}
                    description="Need manual linking"
                    variant="warning"
                  />
                  <SummaryCard
                    label="Excluded"
                    value={summary?.excluded ?? 0}
                    description="Manage excluded"
                    onClick={() => setExcludedModalOpen(true)}
                  />
                </>
              )}
            </div>

            {/* Sync Status */}
            <SyncStatusCard
              syncStatus={syncStatus?.syncStatus}
              isLoading={syncLoading}
              tab="ebay"
            />

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

            {/* Filters and Table */}
            <ArbitrageFilters
              filters={ebayFilters}
              onFiltersChange={handleEbayFiltersChange}
              totalItems={totalCount}
              opportunities={ebayOpportunityCount}
              unmappedCount={summary?.unmapped ?? 0}
              onOpenExcluded={() => setExcludedModalOpen(true)}
              showFilterOptions={EBAY_SHOW_FILTER_OPTIONS}
              sortOptions={EBAY_SORT_OPTIONS}
              defaultSortField="ebay_margin"
            />
            <ArbitrageTable
              items={items}
              isLoading={dataLoading}
              minMargin={100 - (ebayFilters.maxCog ?? 50)}
              maxCog={ebayFilters.maxCog ?? 50}
              onRowClick={handleRowClick}
              sortField={ebayFilters.sortField}
              sortDirection={ebayFilters.sortDirection}
              onSort={handleEbaySort}
            />
          </TabsContent>

          {/* Seeded Tab Content */}
          <TabsContent value="seeded" className="mt-6">
            <SeededAsinManager />
          </TabsContent>
        </Tabs>

        {/* Detail Modals */}
        {activeTab === 'ebay' ? (
          <EbayDetailModal
            item={selectedItem ?? null}
            isOpen={!!selectedAsin}
            onClose={handleCloseDetail}
            onExclude={handleExclude}
          />
        ) : (
          <ArbitrageDetailModal
            item={selectedItem ?? null}
            isOpen={!!selectedAsin}
            onClose={handleCloseDetail}
            onExclude={handleExclude}
          />
        )}

        {/* Excluded ASINs Modal */}
        <ExcludedAsinsModal
          isOpen={excludedModalOpen}
          onClose={() => setExcludedModalOpen(false)}
        />
      </div>
    </>
  );
}

// Main export with Suspense wrapper for useSearchParams
export default function ArbitragePage() {
  return (
    <Suspense fallback={<ArbitragePageSkeleton />}>
      <ArbitragePageContent />
    </Suspense>
  );
}

// Components

function SummaryCard({
  label,
  value,
  description,
  variant,
  onClick,
}: {
  label: string;
  value: number;
  description: string;
  variant?: 'default' | 'success' | 'warning';
  onClick?: () => void;
}) {
  const cardClasses = {
    default: '',
    success: 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20',
    warning: '',
  };

  const valueClasses = {
    default: '',
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-amber-600 dark:text-amber-400',
  };

  return (
    <Card className={cardClasses[variant ?? 'default']}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl ${valueClasses[variant ?? 'default']}`}>
          {value.toLocaleString()}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {onClick ? (
          <button
            onClick={onClick}
            className="text-xs text-primary hover:underline"
          >
            {description}
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
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

function SyncStatusCard({
  syncStatus,
  isLoading,
  tab,
}: {
  syncStatus: Record<string, { lastRunAt?: string | null; lastSuccessAt?: string | null; status?: string | null } | null> | undefined;
  isLoading: boolean;
  tab: 'bricklink' | 'ebay';
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Sync Status
            </CardTitle>
            <CardDescription>Data synced automatically. Shows actual last run time.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex gap-4">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-48" />
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            <SyncStatusBadge
              label="Amazon Inventory"
              syncData={syncStatus?.inventory_asins}
            />
            <SyncStatusBadge
              label="Amazon Pricing"
              syncData={syncStatus?.amazon_pricing}
            />
            {tab === 'bricklink' ? (
              <SyncStatusBadge
                label="BrickLink"
                syncData={syncStatus?.bricklink_pricing}
              />
            ) : (
              <SyncStatusBadge
                label="eBay"
                syncData={syncStatus?.ebay_pricing}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SyncStatusBadge({
  label,
  syncData,
}: {
  label: string;
  syncData: { lastRunAt?: string | null; lastSuccessAt?: string | null; status?: string | null } | null | undefined;
}) {
  const lastSync = syncData?.lastRunAt ?? syncData?.lastSuccessAt;
  const status = syncData?.status;

  const isStale = !lastSync || (Date.now() - new Date(lastSync).getTime()) > 3 * 24 * 60 * 60 * 1000;
  const isRecent = lastSync && (Date.now() - new Date(lastSync).getTime()) < 24 * 60 * 60 * 1000;
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
        </span>
      </div>
    </div>
  );
}

function ArbitragePageSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-10 w-96" />
      <div className="grid grid-cols-4 gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-20" />
      <Skeleton className="h-12" />
      <Skeleton className="h-96" />
    </div>
  );
}
