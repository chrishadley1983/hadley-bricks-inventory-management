'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { HeaderSkeleton } from '@/components/ui/skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  useExplorerOverview,
  useExplorerSyncStatus,
  useExplorerItems,
  useExplorerSync,
  useExplorerEnrich,
  type ItemType as ExplorerItemType,
  type ItemsFilters,
} from '@/hooks/use-inventory-explorer';
import { RefreshCw, Package, Layers, Users, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDistanceToNow } from 'date-fns';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

// ============================================
// Helper: format GBP
// ============================================
function gbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(value);
}

function num(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

// ============================================
// Sync Status Banner
// ============================================
function SyncBanner() {
  const { data: status, isLoading } = useExplorerSyncStatus();
  const { sync, isSyncing, progress: syncProgress, result: syncResult } = useExplorerSync();
  const { enrich, isEnriching, progress: enrichProgress, result: enrichResult } = useExplorerEnrich();
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [showEnrichDialog, setShowEnrichDialog] = useState(false);

  const handleSync = () => {
    setShowSyncDialog(true);
    sync();
  };

  const handleEnrich = () => {
    setShowEnrichDialog(true);
    enrich();
  };

  if (isLoading) return <Skeleton className="h-10 w-full" />;

  const lastSync = status?.lastFullSync
    ? formatDistanceToNow(new Date(status.lastFullSync), { addSuffix: true })
    : null;

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {status?.syncStatus === 'running' ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Syncing from Bricqer (page {status.syncCursor})...</span>
          </>
        ) : status?.syncStatus === 'failed' ? (
          <>
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span>Last sync failed: {status.syncError}</span>
          </>
        ) : lastSync ? (
          <>
            <Clock className="h-4 w-4" />
            <span>
              Last synced {lastSync} &middot; {num(status?.totalItems || 0)} items &middot; {num(status?.totalLots || 0)} lots
              {status?.staleLots !== undefined && status.staleLots > 0 && (
                <> &middot; <span className="text-amber-600">{num(status.staleLots)} need BL enrichment</span></>
              )}
              {status?.staleLots === 0 && status?.enrichedLots !== undefined && status.enrichedLots > 0 && (
                <> &middot; <span className="text-green-600">all enriched</span></>
              )}
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4" />
            <span>No sync yet — click Sync Now to pull your Bricqer inventory</span>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleSync}
          disabled={isSyncing || status?.syncStatus === 'running'}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          Sync
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleEnrich}
          disabled={isEnriching || !status?.lastFullSync}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isEnriching ? 'animate-spin' : ''}`} />
          Enrich BL
        </Button>
      </div>

      {/* Sync Progress Dialog */}
      <Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bricqer Inventory Sync</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {syncProgress && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {syncProgress.status === 'completed'
                      ? 'Complete!'
                      : syncProgress.status === 'failed'
                        ? 'Failed'
                        : `Page ${syncProgress.page} of ${syncProgress.totalPages}...`}
                  </span>
                  <span className="text-muted-foreground">
                    {num(syncProgress.itemsFetched)} / {num(syncProgress.totalItems)} items
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      syncProgress.status === 'completed'
                        ? 'bg-green-500'
                        : syncProgress.status === 'failed'
                          ? 'bg-destructive'
                          : 'bg-primary'
                    }`}
                    style={{
                      width: `${syncProgress.totalPages > 0 ? Math.round((syncProgress.page / syncProgress.totalPages) * 100) : 0}%`,
                    }}
                  />
                </div>
                {syncProgress.status === 'completed' && syncResult && (
                  <p className="text-sm text-muted-foreground">
                    Synced {num(syncResult.itemsSynced)} items from Bricqer.
                  </p>
                )}
              </>
            )}
            {syncProgress?.status === 'completed' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setShowSyncDialog(false)}
              >
                Close
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Enrichment Progress Dialog */}
      <Dialog open={showEnrichDialog} onOpenChange={setShowEnrichDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>BrickLink Enrichment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {enrichProgress && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {enrichProgress.status === 'completed'
                      ? 'Complete!'
                      : enrichProgress.status === 'failed'
                        ? 'Failed'
                        : `Processing ${enrichProgress.processed} of ${enrichProgress.total}...`}
                  </span>
                  <span className="text-muted-foreground">
                    {enrichProgress.fetched} fetched &middot; {enrichProgress.errors} errors
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      enrichProgress.status === 'completed'
                        ? 'bg-green-500'
                        : enrichProgress.status === 'failed'
                          ? 'bg-destructive'
                          : 'bg-primary'
                    }`}
                    style={{
                      width: `${enrichProgress.total > 0 ? Math.round((enrichProgress.processed / enrichProgress.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                {enrichProgress.status === 'completed' && enrichResult && (
                  <p className="text-sm text-muted-foreground">
                    Enriched {enrichResult.newlyFetched} items with BrickLink data.
                    {enrichResult.errors > 0 && ` ${enrichResult.errors} errors.`}
                  </p>
                )}
              </>
            )}
            {enrichProgress?.status === 'completed' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setShowEnrichDialog(false)}
              >
                Close
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================
// Overview Tab
// ============================================
function OverviewTab() {
  const { data, isLoading, error } = useExplorerOverview();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        {error ? `Error: ${error.message}` : 'No data — sync your inventory first.'}
      </div>
    );
  }

  const conditionColors: Record<string, string> = {
    New: 'bg-blue-500',
    Used: 'bg-amber-500',
  };

  const typeColors: Record<string, string> = {
    Part: 'bg-blue-500',
    Minifig: 'bg-purple-500',
    Set: 'bg-green-500',
  };

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Total Items</p>
          <p className="text-3xl font-bold">{num(data.totalItems)}</p>
          <p className="text-sm text-muted-foreground">{num(data.totalLots)} lots</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Estimated Value</p>
          <p className="text-3xl font-bold">{gbp(data.estimatedValue)}</p>
          <p className="text-sm text-muted-foreground">Based on Bricqer prices</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Average STR</p>
          <p className="text-3xl font-bold">
            {data.averageSTR !== null ? `${data.averageSTR}%` : '—'}
          </p>
          <p className="text-sm text-muted-foreground">Based on BrickLink sales</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">Item Types</p>
          <p className="text-3xl font-bold">{data.typeBreakdown.length}</p>
          <p className="text-sm text-muted-foreground">
            {data.typeBreakdown.map((t) => t.type).join(', ')}
          </p>
        </div>
      </div>

      {/* Condition & Type Breakdowns */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* By Condition */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">By Condition</h3>
          <div className="space-y-2">
            {data.conditionBreakdown.map((row) => (
              <div key={row.condition} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${conditionColors[row.condition] || 'bg-gray-400'}`} />
                  <span>{row.condition}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground">{row.percentage}%</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {num(row.items)} items
                  </Badge>
                  <span className="w-24 text-right font-medium">{gbp(row.value)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Type */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">By Type</h3>
          <div className="space-y-2">
            {data.typeBreakdown.map((row) => (
              <div key={row.type} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${typeColors[row.type] || 'bg-gray-400'}`} />
                  <span>{row.type}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground">{row.percentage}%</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {num(row.items)} items
                  </Badge>
                  <span className="w-24 text-right font-medium">{gbp(row.value)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top 10 Most Valuable Lots */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Top 10 Most Valuable Lots</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">STR</th>
              </tr>
            </thead>
            <tbody>
              {data.top10.map((item, i) => (
                <tr key={`${item.itemNumber}-${i}`} className="border-b last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.itemName}
                          className="h-8 w-8 rounded object-contain"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium">{item.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.itemNumber}
                          {item.colorName && (
                            <>
                              {' '}&middot;{' '}
                              {item.colorRgb && (
                                <span
                                  className="mr-1 inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: `#${item.colorRgb}` }}
                                />
                              )}
                              {item.colorName}
                            </>
                          )}
                          {' '}&middot; {item.condition}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{num(item.quantity)}</td>
                  <td className="px-3 py-2 text-right font-mono">{gbp(item.avgPrice)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{gbp(item.value)}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-600">
                    {item.str !== null ? `${Math.round(item.str)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Items Tab (reusable for Sets, Parts, Minifigs)
// ============================================
function ItemsTab({ type }: { type: ExplorerItemType }) {
  const [filters, setFilters] = useState<ItemsFilters>({
    type,
    search: '',
    condition: '',
    color: '',
    enriched: '',
    page: 1,
    sort: 'totalValue',
    dir: 'desc',
  });

  const { data, isLoading } = useExplorerItems(filters);

  const updateFilter = (updates: Partial<ItemsFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates, page: updates.page ?? 1 }));
  };

  const toggleSort = (field: string) => {
    setFilters((prev) => ({
      ...prev,
      sort: field,
      dir: prev.sort === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortIndicator = (field: string) => {
    if (filters.sort !== field) return '';
    return filters.dir === 'asc' ? ' \u2191' : ' \u2193';
  };

  const typeLabels: Record<ExplorerItemType, { icon: React.ReactNode; label: string }> = {
    Part: { icon: <Layers className="h-4 w-4" />, label: 'Parts' },
    Set: { icon: <Package className="h-4 w-4" />, label: 'Sets' },
    Minifig: { icon: <Users className="h-4 w-4" />, label: 'Minifigures' },
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">{typeLabels[type].label}</h3>
        {data && (
          <div className="flex gap-2">
            <Badge variant="outline">{num(data.totalItems)} items</Badge>
            <Badge variant="outline">{num(data.totalLots)} lots</Badge>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search items..."
          value={filters.search}
          onChange={(e) => updateFilter({ search: e.target.value })}
          className="w-64"
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.condition}
          onChange={(e) => updateFilter({ condition: e.target.value })}
        >
          <option value="">All conditions</option>
          <option value="New">New</option>
          <option value="Used">Used</option>
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.enriched}
          onChange={(e) => updateFilter({ enriched: e.target.value })}
        >
          <option value="">All STR</option>
          <option value="yes">Has STR</option>
          <option value="no">No STR</option>
        </select>
        {type === 'Part' && data?.colors && data.colors.length > 0 && (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={filters.color}
            onChange={(e) => updateFilter({ color: e.target.value })}
          >
            <option value="">All colors</option>
            {data.colors.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card px-4 py-3 text-center">
            <p className="text-2xl font-bold">{num(data.totalItems)}</p>
            <p className="text-xs text-muted-foreground">Items</p>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3 text-center">
            <p className="text-2xl font-bold">{num(data.totalLots)}</p>
            <p className="text-xs text-muted-foreground">Lots</p>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3 text-center">
            <p className="text-2xl font-bold">{gbp(data.totalValue)}</p>
            <p className="text-xs text-muted-foreground">Value</p>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3 text-center">
            <p className="text-2xl font-bold">
              {data.totalItems > 0 ? gbp(data.totalValue / data.totalLots) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">Avg / Lot</p>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : data && data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium hover:text-foreground"
                  onClick={() => toggleSort('item_name')}
                >
                  Item{sortIndicator('item_name')}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => toggleSort('quantity')}
                >
                  Qty{sortIndicator('quantity')}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => toggleSort('bricqer_price')}
                >
                  Price{sortIndicator('bricqer_price')}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => toggleSort('totalValue')}
                >
                  Value{sortIndicator('totalValue')}
                </th>
                <th className="px-3 py-2 text-right font-medium">BL Avg</th>
                <th className="px-3 py-2 text-right font-medium">Sold</th>
                <th className="px-3 py-2 text-right font-medium">For Sale</th>
                <th className="px-3 py-2 text-right font-medium">STR</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, idx) => (
                <tr key={`${item.itemNumber}-${item.colorId}-${item.condition}-${idx}`} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.itemName}
                          className="h-8 w-8 rounded object-contain"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium">{item.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.itemNumber}
                          {item.colorName && (
                            <>
                              {' '}&middot;{' '}
                              {item.colorRgb && (
                                <span
                                  className="mr-1 inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: `#${item.colorRgb}` }}
                                />
                              )}
                              {item.colorName}
                            </>
                          )}
                          {' '}&middot; {item.condition}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{num(item.quantity)}</td>
                  <td className="px-3 py-2 text-right font-mono">{gbp(item.price)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {gbp(item.value)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {item.blAvg !== null ? gbp(item.blAvg) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {item.sold !== null ? num(item.sold) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {item.forSale !== null ? num(item.forSale) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-green-600">
                    {item.str !== null ? `${Math.round(item.str)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-12 text-center text-muted-foreground">
          No {typeLabels[type].label.toLowerCase()} found. Sync your inventory first.
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages} ({num(data.totalCount)} lots)
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={data.page <= 1}
              onClick={() => updateFilter({ page: data.page - 1 })}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={data.page >= data.totalPages}
              onClick={() => updateFilter({ page: data.page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Page
// ============================================
export default function InventoryExplorerPage() {
  return (
    <>
      <Header title="Inventory Explorer" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Bricqer Inventory Explorer</h2>
          <p className="text-muted-foreground">Browse your full Bricqer inventory by type</p>
        </div>

        <div className="mb-6">
          <SyncBanner />
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Inventory Overview</TabsTrigger>
            <TabsTrigger value="sets">Sets</TabsTrigger>
            <TabsTrigger value="parts">Parts</TabsTrigger>
            <TabsTrigger value="minifigures">Minifigures</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="sets">
            <ItemsTab type="Set" />
          </TabsContent>
          <TabsContent value="parts">
            <ItemsTab type="Part" />
          </TabsContent>
          <TabsContent value="minifigures">
            <ItemsTab type="Minifig" />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
