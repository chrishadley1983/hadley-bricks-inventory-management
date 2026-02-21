'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlatformSyncStatus {
  platform: string;
  label: string;
  isConfigured: boolean;
  lastSyncedAt: string | null;
  status: 'synced' | 'stale' | 'error' | 'never';
  orderCount?: number;
}

interface SyncStatusResponse {
  platforms: PlatformSyncStatus[];
}

interface SyncSummaryItem {
  platform: string;
  type: 'order' | 'transaction' | 'stock';
  status: 'COMPLETED' | 'FAILED' | 'RUNNING';
  processed: number;
  created: number;
  updated: number;
  error?: string;
  syncedAt: string;
  latestDataDate?: string;
}

interface SyncSummaryResponse {
  items: SyncSummaryItem[];
  overallStatus: 'success' | 'partial' | 'failed';
  syncedAt: string;
}

async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  const platforms: PlatformSyncStatus[] = [];

  // eBay
  try {
    const ebayRes = await fetch('/api/integrations/ebay/status');
    if (ebayRes.ok) {
      const ebayData = await ebayRes.json();
      platforms.push({
        platform: 'ebay',
        label: 'eBay',
        isConfigured: ebayData.data?.isConfigured ?? false,
        lastSyncedAt: ebayData.data?.lastSyncedAt ?? null,
        status: getStatus(ebayData.data?.lastSyncedAt, ebayData.data?.isConfigured),
        orderCount: ebayData.data?.totalOrders,
      });
    }
  } catch {
    platforms.push({
      platform: 'ebay',
      label: 'eBay',
      isConfigured: false,
      lastSyncedAt: null,
      status: 'error',
    });
  }

  // Amazon
  try {
    const amazonRes = await fetch('/api/integrations/amazon/credentials');
    if (amazonRes.ok) {
      const amazonData = await amazonRes.json();
      const hasCredentials = !!amazonData.data?.hasCredentials;
      platforms.push({
        platform: 'amazon',
        label: 'Amazon',
        isConfigured: hasCredentials,
        lastSyncedAt: null,
        status: hasCredentials ? 'synced' : 'never',
      });
    }
  } catch {
    platforms.push({
      platform: 'amazon',
      label: 'Amazon',
      isConfigured: false,
      lastSyncedAt: null,
      status: 'error',
    });
  }

  // BrickLink
  try {
    const blRes = await fetch('/api/integrations/bricklink/status');
    if (blRes.ok) {
      const blData = await blRes.json();
      platforms.push({
        platform: 'bricklink',
        label: 'BrickLink',
        isConfigured: blData.data?.isConfigured ?? false,
        lastSyncedAt: blData.data?.lastSyncedAt ?? null,
        status: getStatus(blData.data?.lastSyncedAt, blData.data?.isConfigured),
      });
    }
  } catch {
    platforms.push({
      platform: 'bricklink',
      label: 'BrickLink',
      isConfigured: false,
      lastSyncedAt: null,
      status: 'error',
    });
  }

  // Brick Owl
  try {
    const boRes = await fetch('/api/integrations/brickowl/status');
    if (boRes.ok) {
      const boData = await boRes.json();
      platforms.push({
        platform: 'brickowl',
        label: 'Brick Owl',
        isConfigured: boData.data?.isConfigured ?? false,
        lastSyncedAt: boData.data?.lastSyncedAt ?? null,
        status: getStatus(boData.data?.lastSyncedAt, boData.data?.isConfigured),
      });
    }
  } catch {
    platforms.push({
      platform: 'brickowl',
      label: 'Brick Owl',
      isConfigured: false,
      lastSyncedAt: null,
      status: 'error',
    });
  }

  return { platforms };
}

function getStatus(
  lastSyncedAt: string | null,
  isConfigured: boolean
): PlatformSyncStatus['status'] {
  if (!isConfigured) return 'never';
  if (!lastSyncedAt) return 'stale';

  const syncDate = new Date(lastSyncedAt);
  const now = new Date();
  const hoursSinceSync = (now.getTime() - syncDate.getTime()) / (1000 * 60 * 60);

  if (hoursSinceSync > 24) return 'stale';
  return 'synced';
}

interface SyncOptions {
  orders: {
    ebay: boolean;
    amazon: boolean;
    bricklink: boolean;
    brickowl: boolean;
  };
  transactions: boolean;
  stockImports: {
    ebay: boolean;
    amazon: boolean;
  };
}

async function syncPlatforms(options: SyncOptions): Promise<void> {
  const promises: Promise<Response>[] = [];

  // Order syncs
  if (options.orders.ebay) {
    promises.push(fetch('/api/integrations/ebay/sync', { method: 'POST' }));
  }
  if (options.orders.brickowl) {
    promises.push(fetch('/api/integrations/brickowl/sync', { method: 'POST' }));
  }
  if (options.orders.bricklink) {
    promises.push(fetch('/api/integrations/bricklink/sync', { method: 'POST' }));
  }
  if (options.orders.amazon) {
    promises.push(fetch('/api/integrations/amazon/sync', { method: 'POST' }));
  }

  // Transaction syncs
  if (options.transactions) {
    promises.push(fetch('/api/integrations/monzo/sync', { method: 'POST' }));
    promises.push(
      fetch('/api/integrations/ebay/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'all' }),
      })
    );
    promises.push(fetch('/api/integrations/paypal/sync', { method: 'POST' }));
    promises.push(
      fetch('/api/integrations/bricklink/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionsOnly: true }),
      })
    );
    promises.push(fetch('/api/integrations/brickowl/sync', { method: 'POST' }));
    promises.push(fetch('/api/integrations/amazon/transactions/sync', { method: 'POST' }));
  }

  // Stock imports
  if (options.stockImports.ebay) {
    promises.push(fetch('/api/ebay-stock/import', { method: 'POST' }));
  }
  if (options.stockImports.amazon) {
    promises.push(fetch('/api/platform-stock/amazon/import', { method: 'POST' }));
  }

  await Promise.allSettled(promises);
}

async function fetchSyncSummary(): Promise<SyncSummaryResponse> {
  const res = await fetch('/api/integrations/sync-summary');
  if (!res.ok) throw new Error('Failed to fetch sync summary');
  return res.json();
}

function formatDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface PlatformSyncStatusGridProps {
  className?: string;
}

export function PlatformSyncStatusGrid({ className }: PlatformSyncStatusGridProps) {
  const queryClient = useQueryClient();

  // Track selected platforms for sync
  const [selectedOrders, setSelectedOrders] = useState({
    ebay: true,
    amazon: true,
    bricklink: true,
    brickowl: true,
  });
  const [transactionsEnabled, setTransactionsEnabled] = useState(true);
  const [stockImportsEnabled, setStockImportsEnabled] = useState({
    ebay: true,
    amazon: true,
  });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'pending' | 'syncing' | 'complete' | 'failed'>(
    'pending'
  );
  const [syncSummary, setSyncSummary] = useState<SyncSummaryResponse | null>(null);
  const [pollingCount, setPollingCount] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-sync-status'],
    queryFn: fetchSyncStatus,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  // Poll for sync summary when syncing
  const pollSyncSummary = useCallback(async () => {
    try {
      const summary = await fetchSyncSummary();
      setSyncSummary(summary);

      // Check if we have results and sync is complete
      if (summary.items.length > 0) {
        const hasRunning = summary.items.some((item) => item.status === 'RUNNING');
        if (!hasRunning) {
          setSyncStatus(summary.overallStatus === 'failed' ? 'failed' : 'complete');
          return true; // Stop polling
        }
      }
      return false; // Continue polling
    } catch {
      // Continue polling on error
      return false;
    }
  }, []);

  // Polling effect
  useEffect(() => {
    if (syncStatus !== 'syncing') return;

    const pollInterval = setInterval(async () => {
      setPollingCount((prev) => prev + 1);
      const shouldStop = await pollSyncSummary();

      // Stop after 30 polls (30 seconds) or when complete
      if (shouldStop || pollingCount >= 30) {
        clearInterval(pollInterval);
        if (!shouldStop) {
          // Timeout - fetch one last time and show results
          const finalSummary = await fetchSyncSummary();
          setSyncSummary(finalSummary);
          setSyncStatus(finalSummary.items.length > 0 ? 'complete' : 'failed');
        }
      }
    }, 1000);

    return () => clearInterval(pollInterval);
  }, [syncStatus, pollingCount, pollSyncSummary]);

  // Refresh workflow data when sync completes
  useEffect(() => {
    if (syncStatus === 'complete' || syncStatus === 'failed') {
      // Invalidate all workflow-related queries to refresh the page
      queryClient.invalidateQueries({ queryKey: ['dispatch-deadlines'] });
      queryClient.invalidateQueries({ queryKey: ['resolution-stats'] });
      queryClient.invalidateQueries({ queryKey: ['platform-sync-status'] });
    }
  }, [syncStatus, queryClient]);

  const syncMutation = useMutation({
    mutationFn: () =>
      syncPlatforms({
        orders: selectedOrders,
        transactions: transactionsEnabled,
        stockImports: stockImportsEnabled,
      }),
    onMutate: () => {
      setDialogOpen(true);
      setSyncStatus('syncing');
      setSyncSummary(null);
      setPollingCount(0);
    },
    onSuccess: () => {
      // Start polling for results
      setTimeout(() => {
        pollSyncSummary();
      }, 2000);
      // Refetch platform status after sync
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['platform-sync-status'] });
      }, 5000);
    },
    onError: () => {
      setSyncStatus('failed');
    },
  });

  const toggleOrderPlatform = (platform: keyof typeof selectedOrders) => {
    setSelectedOrders((prev) => ({
      ...prev,
      [platform]: !prev[platform],
    }));
  };

  const toggleStockImport = (platform: keyof typeof stockImportsEnabled) => {
    setStockImportsEnabled((prev) => ({
      ...prev,
      [platform]: !prev[platform],
    }));
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSyncStatus('pending');
    setSyncSummary(null);
    setPollingCount(0);
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" />
            Platform Sync
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
            <Skeleton className="h-10" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" />
            Platform Sync
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Failed to load sync status</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const platforms = data?.platforms ?? [];
  const hasSelectedSync =
    Object.values(selectedOrders).some(Boolean) ||
    transactionsEnabled ||
    Object.values(stockImportsEnabled).some(Boolean);

  // Group sync summary items
  const orderItems = syncSummary?.items.filter((item) => item.type === 'order') ?? [];
  const transactionItems = syncSummary?.items.filter((item) => item.type === 'transaction') ?? [];
  const stockItems = syncSummary?.items.filter((item) => item.type === 'stock') ?? [];

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" />
              Platform Sync
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !hasSelectedSync}
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Sync All
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-4">
            {/* Order sync platforms */}
            <div className="grid grid-cols-2 gap-3">
              {platforms.map((platform) => {
                const platformKey = platform.platform as keyof typeof selectedOrders;
                const isSelected = selectedOrders[platformKey] ?? false;

                return (
                  <div
                    key={platform.platform}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors',
                      platform.status === 'error' &&
                        'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20',
                      platform.status === 'stale' &&
                        'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20',
                      platform.status === 'synced' &&
                        'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20',
                      platform.status === 'never' &&
                        'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/20',
                      isSelected && 'ring-2 ring-primary ring-offset-1'
                    )}
                    onClick={() => toggleOrderPlatform(platformKey)}
                  >
                    <Checkbox
                      id={`order-${platform.platform}`}
                      checked={isSelected}
                      onCheckedChange={() => toggleOrderPlatform(platformKey)}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      className="flex-shrink-0"
                    />
                    <Label
                      htmlFor={`order-${platform.platform}`}
                      className="flex items-center gap-2 cursor-pointer flex-1"
                    >
                      <span className="text-sm font-medium">{platform.label}</span>
                    </Label>
                  </div>
                );
              })}
            </div>

            {/* Transactions sync option */}
            <div
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors',
                'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20',
                transactionsEnabled && 'ring-2 ring-primary ring-offset-1'
              )}
              onClick={() => setTransactionsEnabled(!transactionsEnabled)}
            >
              <Checkbox
                id="transactions-sync"
                checked={transactionsEnabled}
                onCheckedChange={() => setTransactionsEnabled(!transactionsEnabled)}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                className="flex-shrink-0"
              />
              <Label
                htmlFor="transactions-sync"
                className="flex items-center gap-2 cursor-pointer flex-1"
              >
                <span className="text-sm font-medium">Transactions</span>
                <span className="text-xs text-muted-foreground">
                  (Monzo, eBay, PayPal, BrickLink, BrickOwl, Amazon)
                </span>
              </Label>
            </div>

            {/* Stock imports option */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors',
                  'border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/20',
                  stockImportsEnabled.ebay && 'ring-2 ring-primary ring-offset-1'
                )}
                onClick={() => toggleStockImport('ebay')}
              >
                <Checkbox
                  id="stock-ebay"
                  checked={stockImportsEnabled.ebay}
                  onCheckedChange={() => toggleStockImport('ebay')}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  className="flex-shrink-0"
                />
                <Label htmlFor="stock-ebay" className="flex flex-col cursor-pointer flex-1">
                  <span className="text-sm font-medium">eBay Stock</span>
                  <span className="text-xs text-muted-foreground">Refresh listings</span>
                </Label>
              </div>
              <div
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors',
                  'border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/20',
                  stockImportsEnabled.amazon && 'ring-2 ring-primary ring-offset-1'
                )}
                onClick={() => toggleStockImport('amazon')}
              >
                <Checkbox
                  id="stock-amazon"
                  checked={stockImportsEnabled.amazon}
                  onCheckedChange={() => toggleStockImport('amazon')}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  className="flex-shrink-0"
                />
                <Label htmlFor="stock-amazon" className="flex flex-col cursor-pointer flex-1">
                  <span className="text-sm font-medium">Amazon Stock</span>
                  <span className="text-xs text-muted-foreground">Refresh listings</span>
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sync Progress Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {syncStatus === 'syncing' && (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  Sync in Progress
                </>
              )}
              {syncStatus === 'complete' && (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Sync Complete
                </>
              )}
              {syncStatus === 'failed' && (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  Sync Failed
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {syncStatus === 'syncing' && 'Please wait while we sync your data...'}
              {syncStatus === 'complete' && 'All sync operations have completed.'}
              {syncStatus === 'failed' && 'Some sync operations failed. See details below.'}
            </DialogDescription>
          </DialogHeader>

          {syncSummary && syncSummary.items.length > 0 && (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {/* Order Syncs */}
              {orderItems.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Order Syncs</h4>
                  <div className="space-y-2">
                    {orderItems.map((item, idx) => (
                      <div
                        key={`order-${idx}`}
                        className={cn(
                          'p-3 rounded-lg border text-sm',
                          item.status === 'COMPLETED' &&
                            'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20',
                          item.status === 'FAILED' &&
                            'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20',
                          item.status === 'RUNNING' &&
                            'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{item.platform}</span>
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded',
                              item.status === 'COMPLETED' && 'bg-green-200 text-green-800',
                              item.status === 'FAILED' && 'bg-red-200 text-red-800',
                              item.status === 'RUNNING' && 'bg-blue-200 text-blue-800'
                            )}
                          >
                            {item.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>
                            Processed: {item.processed} | Created: {item.created} | Updated:{' '}
                            {item.updated}
                          </div>
                          <div>Latest Order: {formatDate(item.latestDataDate)}</div>
                          {item.error && (
                            <div className="text-red-600 mt-1">Error: {item.error}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transaction Syncs */}
              {transactionItems.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Transaction Syncs</h4>
                  <div className="space-y-2">
                    {transactionItems.map((item, idx) => (
                      <div
                        key={`txn-${idx}`}
                        className={cn(
                          'p-3 rounded-lg border text-sm',
                          item.status === 'COMPLETED' &&
                            'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20',
                          item.status === 'FAILED' &&
                            'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20',
                          item.status === 'RUNNING' &&
                            'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{item.platform}</span>
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded',
                              item.status === 'COMPLETED' && 'bg-green-200 text-green-800',
                              item.status === 'FAILED' && 'bg-red-200 text-red-800',
                              item.status === 'RUNNING' && 'bg-blue-200 text-blue-800'
                            )}
                          >
                            {item.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>
                            Processed: {item.processed} | Created: {item.created} | Updated:{' '}
                            {item.updated}
                          </div>
                          <div>Latest Transaction: {formatDate(item.latestDataDate)}</div>
                          {item.error && (
                            <div className="text-red-600 mt-1">Error: {item.error}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stock Imports */}
              {stockItems.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Stock Imports</h4>
                  <div className="space-y-2">
                    {stockItems.map((item, idx) => (
                      <div
                        key={`stock-${idx}`}
                        className={cn(
                          'p-3 rounded-lg border text-sm',
                          item.status === 'COMPLETED' &&
                            'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20',
                          item.status === 'FAILED' &&
                            'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20',
                          item.status === 'RUNNING' &&
                            'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{item.platform}</span>
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded',
                              item.status === 'COMPLETED' && 'bg-green-200 text-green-800',
                              item.status === 'FAILED' && 'bg-red-200 text-red-800',
                              item.status === 'RUNNING' && 'bg-blue-200 text-blue-800'
                            )}
                          >
                            {item.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>
                            Processed: {item.processed} | Created: {item.created} | Updated:{' '}
                            {item.updated}
                          </div>
                          {item.error && (
                            <div className="text-red-600 mt-1">Error: {item.error}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {syncStatus === 'syncing' && !syncSummary && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          <DialogFooter>
            <Button onClick={handleCloseDialog} disabled={syncStatus === 'syncing'}>
              {syncStatus === 'syncing' ? 'Please wait...' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
