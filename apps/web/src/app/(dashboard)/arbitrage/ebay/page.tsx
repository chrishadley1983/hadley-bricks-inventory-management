'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, CheckCircle2, EyeOff, Link2Off, Clock, ExternalLink, CalendarClock } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
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
  useExcludeAsin,
} from '@/hooks/use-arbitrage';
import type { ArbitrageFilterOptions, ArbitrageItem } from '@/lib/arbitrage/types';
import { EBAY_SHOW_FILTER_OPTIONS, EBAY_SORT_OPTIONS } from '@/lib/arbitrage/types';
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
  usePerfPage('EbayArbitragePage');
  const [activeTab, setActiveTab] = useState<TabValue>('opportunities');
  const [filters, setFilters] = useState<ArbitrageFilterOptions>({
    sortField: 'ebay_margin',
    pageSize: 50,
    page: 1,
  });
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
    // Reset to page 1 when filters change (unless page is explicitly being changed)
    const pageChanged = newFilters.page !== undefined && newFilters.page !== filters.page;
    if (!pageChanged) {
      newFilters.page = 1;
    }
    setFilters(newFilters);
  }, [filters.page]);

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

  // Extract items and filter for eBay opportunities
  const items = arbitrageData?.items ?? [];
  const totalCount = arbitrageData?.totalCount ?? 0;

  // Use server-side eBay opportunities count (more accurate than client-side filtering of paginated items)
  const ebayOpportunityCount = summary?.ebayOpportunities ?? 0;

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
                />
                <SyncStatusBadge
                  label="BrickLink"
                  lastSync={syncStatus?.syncStatus?.bricklink_pricing?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.bricklink_pricing?.status}
                  schedule="2:30am"
                />
                <SyncStatusBadge
                  label="eBay"
                  lastSync={syncStatus?.syncStatus?.ebay_pricing?.lastSuccessAt}
                  status={syncStatus?.syncStatus?.ebay_pricing?.status}
                  schedule="2:00am"
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
              showFilterOptions={EBAY_SHOW_FILTER_OPTIONS}
              sortOptions={EBAY_SORT_OPTIONS}
              defaultSortField="ebay_margin"
            />
            <EbayArbitrageTable
              items={items}
              isLoading={dataLoading}
              minMargin={filters.minMargin ?? 30}
              onRowClick={handleRowClick}
            />
            {/* Pagination */}
            {!dataLoading && totalCount > 0 && (() => {
              const currentPage = filters.page ?? 1;
              const pageSize = filters.pageSize ?? 50;
              const totalPages = Math.ceil(totalCount / pageSize);
              const startItem = (currentPage - 1) * pageSize + 1;
              const endItem = Math.min(currentPage * pageSize, totalCount);

              return (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Showing {startItem}-{endItem} of {totalCount} items
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setFilters(f => ({ ...f, page: 1 }))}
                    >
                      First
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setFilters(f => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))}
                    >
                      Previous
                    </Button>
                    <span className="px-3 py-1 text-sm font-medium">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) + 1 }))}
                    >
                      Next
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => setFilters(f => ({ ...f, page: totalPages }))}
                    >
                      Last
                    </Button>
                  </div>
                </div>
              );
            })()}
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
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm table-fixed">
            <thead className="border-b bg-muted/50 sticky top-0 z-10 bg-card">
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
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{item.name || item.asin}</p>
                            {item.itemType === 'seeded' && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 ${
                                  item.seededMatchConfidence && item.seededMatchConfidence >= 95
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : item.seededMatchConfidence && item.seededMatchConfidence >= 85
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}
                                title={`${item.seededMatchMethod ?? 'unknown'} match (${item.seededMatchConfidence ?? 0}%)`}
                              >
                                Seeded
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{item.bricklinkSetNumber || 'Unmapped'}</span>
                            <span>|</span>
                            <span>{item.asin}</span>
                            {item.bricksetRrp != null && (
                              <>
                                <span>|</span>
                                <span>RRP: {formatCurrency(item.bricksetRrp, 'GBP')}</span>
                              </>
                            )}
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
                      {(() => {
                        const effectivePrice = item.effectiveAmazonPrice ?? item.buyBoxPrice ?? item.lowestOfferPrice;
                        const hasBuyBox = item.buyBoxPrice !== null;
                        return (
                          <div>
                            <span className={hasBuyBox ? '' : 'text-muted-foreground'}>
                              {effectivePrice ? formatCurrency(effectivePrice, 'GBP') : '—'}
                            </span>
                            {effectivePrice && !hasBuyBox && (
                              <div className="text-[10px] text-muted-foreground">Lowest</div>
                            )}
                          </div>
                        );
                      })()}
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
