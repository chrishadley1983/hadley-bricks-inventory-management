'use client';

import { useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw, AlertCircle, CheckCircle2, EyeOff, Link2Off, Clock, ExternalLink } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  ArbitrageFilters,
  ExcludedAsinsModal,
  UnmappedAsinsTable,
} from '@/components/features/arbitrage';
import { EbayDetailModal } from '@/components/features/arbitrage/EbayDetailModal';
import {
  useArbitrageData,
  useArbitrageItem,
  useSyncStatus,
  useArbitrageSummary,
  useTriggerSync,
  useExcludeAsin,
  useEbaySyncWithProgress,
  type EbaySyncProgress,
} from '@/hooks/use-arbitrage';
import type { ArbitrageFilterOptions, ArbitrageItem, SyncJobType } from '@/lib/arbitrage/types';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import { buildEbaySearchUrl } from '@/lib/arbitrage/ebay-url';

// Dynamic import for Header to avoid SSR issues
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

type TabValue = 'opportunities' | 'unmapped' | 'settings';

export default function EbayArbitragePage() {
  const [activeTab, setActiveTab] = useState<TabValue>('opportunities');
  const [filters, setFilters] = useState<ArbitrageFilterOptions>({
    sortField: 'ebay_margin',
  });
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [excludedModalOpen, setExcludedModalOpen] = useState(false);
  const [ebaySyncProgress, setEbaySyncProgress] = useState<EbaySyncProgress | null>(null);
  const { toast } = useToast();

  // Data hooks
  const { data: arbitrageData, isLoading: dataLoading, error: dataError } = useArbitrageData(filters);
  const { data: selectedItem } = useArbitrageItem(selectedAsin);
  const { data: syncStatus, isLoading: syncLoading, refetch: refetchSyncStatus } = useSyncStatus();
  const { data: summary, isLoading: summaryLoading } = useArbitrageSummary();

  // Mutations
  const syncMutation = useTriggerSync();
  const excludeMutation = useExcludeAsin();
  const ebaySyncMutation = useEbaySyncWithProgress();

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

  const handleSync = async (type: SyncJobType | 'all') => {
    // Use streaming sync for eBay to show progress
    if (type === 'ebay_pricing') {
      try {
        setEbaySyncProgress({ type: 'start', message: 'Starting eBay sync...' });
        await ebaySyncMutation.mutateAsync((progress) => {
          setEbaySyncProgress(progress);
        });
        toast({ title: 'eBay sync completed successfully' });
        refetchSyncStatus();
      } catch {
        toast({ title: 'eBay sync failed', variant: 'destructive' });
      } finally {
        // Clear progress after a short delay to show completion
        setTimeout(() => setEbaySyncProgress(null), 2000);
      }
      return;
    }

    try {
      await syncMutation.mutateAsync(type);
      toast({ title: `${type === 'all' ? 'Full sync' : 'Sync'} completed successfully` });
    } catch {
      toast({ title: 'Sync failed', variant: 'destructive' });
    }
  };

  // Extract items and filter for eBay opportunities
  const items = arbitrageData?.items ?? [];
  const totalCount = arbitrageData?.totalCount ?? 0;

  // Count eBay opportunities (items with eBay margin data)
  const ebayOpportunityCount = useMemo(() => {
    const minMargin = filters.minMargin ?? 30;
    return items.filter(item =>
      item.ebayMarginPercent !== null &&
      item.ebayMarginPercent >= minMargin
    ).length;
  }, [items, filters.minMargin]);

  return (
    <>
      <Header title="Arbitrage Tracker - eBay" />
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
                  <CardDescription>eBay Opportunities</CardDescription>
                  <CardTitle className="text-2xl text-green-600 dark:text-green-400">
                    {ebayOpportunityCount}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    &ge;{filters.minMargin ?? 30}% margin potential
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
                <CardTitle className="text-base">Sync Status</CardTitle>
                <CardDescription>Data freshness indicators</CardDescription>
              </div>
              <Button
                onClick={() => handleSync('all')}
                disabled={syncMutation.isPending}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                Full Sync
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {syncLoading ? (
              <div className="flex gap-4">
                <Skeleton className="h-10 w-48" />
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
                  onSync={() => handleSync('inventory_asins')}
                  isSyncing={syncMutation.isPending}
                />
                <SyncStatusBadge
                  label="Amazon Pricing"
                  lastSync={syncStatus?.syncStatus?.amazon_pricing?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.amazon_pricing?.status}
                  onSync={() => handleSync('amazon_pricing')}
                  isSyncing={syncMutation.isPending}
                />
                <SyncStatusBadge
                  label="BrickLink Pricing"
                  lastSync={syncStatus?.syncStatus?.bricklink_pricing?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.bricklink_pricing?.status}
                  onSync={() => handleSync('bricklink_pricing')}
                  isSyncing={syncMutation.isPending}
                />
                <EbaySyncStatusBadge
                  lastSync={syncStatus?.syncStatus?.ebay_pricing?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.ebay_pricing?.status}
                  onSync={() => handleSync('ebay_pricing')}
                  isSyncing={ebaySyncMutation.isPending}
                  progress={ebaySyncProgress}
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
              eBay Opportunities
              {ebayOpportunityCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {ebayOpportunityCount}
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
              opportunities={ebayOpportunityCount}
              unmappedCount={summary?.unmapped ?? 0}
              onOpenExcluded={() => setExcludedModalOpen(true)}
            />
            <EbayArbitrageTable
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
                  <Clock className="h-5 w-5" />
                  Sync Schedule
                </CardTitle>
                <CardDescription>
                  Pricing data is synced periodically to keep comparisons up-to-date.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm">Amazon Inventory</span>
                  <span className="text-sm text-muted-foreground">Every 24 hours</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm">Amazon Pricing</span>
                  <span className="text-sm text-muted-foreground">Every 6 hours</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm">BrickLink Pricing</span>
                  <span className="text-sm text-muted-foreground">Every 12 hours</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">eBay Pricing</span>
                  <span className="text-sm text-muted-foreground">Every 24 hours</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Detail Modal */}
        <EbayDetailModal
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

// eBay-specific Arbitrage Table Component
function EbayArbitrageTable({
  items,
  isLoading,
  minMargin,
  onRowClick,
}: {
  items: ArbitrageItem[];
  isLoading: boolean;
  minMargin: number;
  onRowClick: (item: ArbitrageItem) => void;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>No items found. Try adjusting your filters or sync data first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div>
          <table className="w-full text-sm table-fixed">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Item</th>
                <th className="px-4 py-3 text-right font-medium w-[100px]">Your Price</th>
                <th className="px-4 py-3 text-right font-medium w-[80px]">Buy Box</th>
                <th className="px-4 py-3 text-right font-medium w-[80px]">eBay Min</th>
                <th className="px-4 py-3 text-right font-medium w-[90px]">eBay Margin</th>
                <th className="px-4 py-3 text-right font-medium w-[70px]">Listings</th>
                <th className="px-4 py-3 text-center font-medium w-[60px]">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isOpportunity = item.ebayMarginPercent !== null && item.ebayMarginPercent >= minMargin;
                return (
                  <tr
                    key={item.asin}
                    className={`border-b hover:bg-muted/30 cursor-pointer ${
                      isOpportunity ? 'bg-green-50/30 dark:bg-green-950/10' : ''
                    }`}
                    onClick={() => onRowClick(item)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="w-10 h-10 object-contain rounded flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{item.name || item.asin}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{item.bricklinkSetNumber || 'Unmapped'}</span>
                            <span>|</span>
                            <span>{item.asin}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div>
                        <span className="font-medium">
                          {item.yourPrice ? formatCurrency(item.yourPrice, 'GBP') : '—'}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          Qty: {item.yourQty ?? 0}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.buyBoxPrice ? formatCurrency(item.buyBoxPrice, 'GBP') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.ebayMinPrice ? formatCurrency(item.ebayMinPrice, 'GBP') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.ebayMarginPercent !== null ? (
                        <Badge
                          variant={item.ebayMarginPercent >= minMargin ? 'default' : 'secondary'}
                          className={item.ebayMarginPercent >= minMargin ? 'bg-green-500' : ''}
                        >
                          {item.ebayMarginPercent.toFixed(1)}%
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.ebayTotalListings ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.bricklinkSetNumber && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(buildEbaySearchUrl(item.bricklinkSetNumber!), '_blank');
                          }}
                          title="Search on eBay"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// Sync Status Badge Component
function SyncStatusBadge({
  label,
  lastSync,
  status,
  onSync,
  isSyncing,
}: {
  label: string;
  lastSync: string | null | undefined;
  status: string | null | undefined;
  onSync: () => void;
  isSyncing: boolean;
}) {
  const isStale = !lastSync || (Date.now() - new Date(lastSync).getTime()) > 24 * 60 * 60 * 1000;
  const isError = status === 'failed';

  const formatDate = (date: string | null | undefined) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex items-center gap-2 border rounded-lg px-3 py-2">
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
          {formatDate(lastSync)}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="ml-2 h-7 w-7 p-0"
        onClick={onSync}
        disabled={isSyncing}
      >
        <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
}

// eBay Sync Status Badge with Progress
function EbaySyncStatusBadge({
  lastSync,
  status,
  onSync,
  isSyncing,
  progress,
}: {
  lastSync: string | null | undefined;
  status: string | null | undefined;
  onSync: () => void;
  isSyncing: boolean;
  progress: EbaySyncProgress | null;
}) {
  const isStale = !lastSync || (Date.now() - new Date(lastSync).getTime()) > 24 * 60 * 60 * 1000;
  const isError = status === 'failed';

  const formatDate = (date: string | null | undefined) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Show progress bar when syncing
  if (isSyncing && progress) {
    return (
      <div className="flex flex-col gap-2 border rounded-lg px-3 py-2 min-w-[200px]">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">eBay Pricing</span>
        </div>
        <div className="space-y-1">
          <Progress value={progress.percent ?? 0} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.type === 'start'
                ? 'Starting...'
                : progress.type === 'complete'
                ? 'Complete!'
                : `${progress.processed ?? 0} / ${progress.total ?? 0}`}
            </span>
            <span>{progress.percent ?? 0}%</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border rounded-lg px-3 py-2">
      {isError ? (
        <AlertCircle className="h-4 w-4 text-destructive" />
      ) : isStale ? (
        <Clock className="h-4 w-4 text-amber-500" />
      ) : (
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      )}
      <div className="flex flex-col">
        <span className="text-sm font-medium">eBay Pricing</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(lastSync)}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="ml-2 h-7 w-7 p-0"
        onClick={onSync}
        disabled={isSyncing}
      >
        <RefreshCw className="h-3 w-3" />
      </Button>
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
