/**
 * eBay Auction Sniper Dashboard
 *
 * Monitoring page showing scan status, configuration,
 * recent alerts, and scan history.
 */

'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Gavel,
  Settings,
  Play,
  Clock,
  TrendingUp,
  AlertTriangle,
  Package,
  RefreshCw,
  ExternalLink,
  X,
  Plus,
} from 'lucide-react';

// ============================================
// Queries
// ============================================

const queryKeys = {
  status: ['ebay-auctions', 'status'],
  alerts: (page: number) => ['ebay-auctions', 'alerts', page],
  config: ['ebay-auctions', 'config'],
};

function useAuctionStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: async () => {
      const res = await fetch('/api/ebay-auctions/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json();
    },
    refetchInterval: 30_000, // Refresh every 30s
  });
}

function useAuctionAlerts(page: number) {
  return useQuery({
    queryKey: queryKeys.alerts(page),
    queryFn: async () => {
      const res = await fetch(`/api/ebay-auctions/alerts?page=${page}&pageSize=15`);
      if (!res.ok) throw new Error('Failed to fetch alerts');
      return res.json();
    },
  });
}

function useUpdateConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: Record<string, unknown>) => {
      const res = await fetch('/api/ebay-auctions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to update config');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

function useTriggerScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/cron/ebay-auctions', { method: 'POST' });
      if (!res.ok) throw new Error('Scan failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.status });
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts(1) });
    },
  });
}

// ============================================
// Status Cards
// ============================================

function StatusCards({ data }: { data: Record<string, unknown> | undefined }) {
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="mt-2 h-4 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const config = data.config as Record<string, unknown>;
  const todayStats = data.todayStats as Record<string, number>;
  const lastScan = data.lastScan as Record<string, unknown> | null;
  const isInQuietHours = data.isInQuietHours as boolean;

  const lastScanTime = lastScan?.created_at
    ? new Date(lastScan.created_at as string).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Never';

  const lastScanDuration = lastScan?.duration_ms
    ? `${Math.round((lastScan.duration_ms as number) / 1000)}s`
    : '—';

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">
                {config.enabled ? (
                  isInQuietHours ? (
                    <Badge variant="secondary">Quiet Hours</Badge>
                  ) : (
                    <Badge className="bg-green-600">Active</Badge>
                  )
                ) : (
                  <Badge variant="destructive">Disabled</Badge>
                )}
              </p>
              <p className="text-sm text-muted-foreground mt-1">Scanner Status</p>
            </div>
            <Gavel className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">{lastScanTime}</p>
              <p className="text-sm text-muted-foreground">Last Scan ({lastScanDuration})</p>
            </div>
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">{todayStats.alertsSent}</p>
              <p className="text-sm text-muted-foreground">
                Alerts Today ({todayStats.scansRun} scans)
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">{todayStats.opportunitiesFound}</p>
              <p className="text-sm text-muted-foreground">
                Opportunities ({todayStats.joblotsFound} joblots)
              </p>
            </div>
            <Package className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// Alerts Table
// ============================================

function AlertsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAuctionAlerts(page);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const alerts = (data?.alerts || []) as Record<string, unknown>[];

  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No alerts yet. Alerts will appear here when the scanner finds opportunities.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Set</TableHead>
              <TableHead>eBay Bid</TableHead>
              <TableHead>Amazon</TableHead>
              <TableHead>Profit</TableHead>
              <TableHead>Margin</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Bids</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map((alert) => {
              const isJoblot = alert.is_joblot as boolean;
              const tier = alert.alert_tier as string;
              const margin = alert.margin_percent as number | null;
              const profit = alert.profit_gbp as number | null;

              return (
                <TableRow key={alert.id as string}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(alert.created_at as string).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {isJoblot ? (
                        <Badge variant="outline" className="mr-1">
                          Joblot
                        </Badge>
                      ) : null}
                      {(alert.set_number as string) || '?'}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {alert.ebay_title as string}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono">
                    £{Number(alert.current_bid_gbp).toFixed(2)}
                    {Number(alert.postage_gbp) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {' '}+£{Number(alert.postage_gbp).toFixed(2)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {alert.amazon_price_gbp ? `£${Number(alert.amazon_price_gbp).toFixed(2)}` : '—'}
                  </TableCell>
                  <TableCell className="font-mono font-medium text-green-600">
                    {profit !== null ? `£${profit.toFixed(2)}` : '—'}
                  </TableCell>
                  <TableCell>
                    {margin !== null ? (
                      <Badge
                        variant={margin >= 25 ? 'default' : 'secondary'}
                        className={margin >= 25 ? 'bg-green-600' : 'bg-amber-500 text-white'}
                      >
                        {margin.toFixed(1)}%
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={tier === 'great' ? 'default' : 'secondary'}>
                      {tier}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{String(alert.bid_count)}</TableCell>
                  <TableCell>
                    {(alert.ebay_url as string) && (
                      <a
                        href={alert.ebay_url as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex justify-between items-center mt-4">
          <p className="text-sm text-muted-foreground">
            {data?.totalCount || 0} total alerts
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data?.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// Scan History
// ============================================

function ScanHistoryTab({ recentScans }: { recentScans: Record<string, unknown>[] }) {
  if (!recentScans?.length) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No scan history yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Auctions</TableHead>
              <TableHead>With Sets</TableHead>
              <TableHead>Opportunities</TableHead>
              <TableHead>Alerts</TableHead>
              <TableHead>Joblots</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>API Calls</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentScans.map((scan) => (
              <TableRow key={scan.id as string}>
                <TableCell className="text-sm whitespace-nowrap">
                  {new Date(scan.created_at as string).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell>{scan.auctions_found as number}</TableCell>
                <TableCell>{scan.auctions_with_sets as number}</TableCell>
                <TableCell className="font-medium">
                  {(scan.opportunities_found as number) > 0 ? (
                    <Badge className="bg-green-600">{scan.opportunities_found as number}</Badge>
                  ) : (
                    0
                  )}
                </TableCell>
                <TableCell>{scan.alerts_sent as number}</TableCell>
                <TableCell>{scan.joblots_found as number}</TableCell>
                <TableCell className="text-muted-foreground">
                  {scan.duration_ms ? `${Math.round((scan.duration_ms as number) / 1000)}s` : '—'}
                </TableCell>
                <TableCell>{scan.api_calls_made as number}</TableCell>
                <TableCell>
                  {scan.error_message ? (
                    <Badge variant="destructive">Error</Badge>
                  ) : scan.skipped_reason ? (
                    <Badge variant="secondary">{scan.skipped_reason as string}</Badge>
                  ) : (
                    <Badge variant="outline">OK</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============================================
// Configuration Dialog
// ============================================

function ConfigDialog({
  config,
  open,
  onOpenChange,
}: {
  config: Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateConfig = useUpdateConfig();
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>(config);
  const [newExcludedSet, setNewExcludedSet] = useState('');

  const handleSave = () => {
    updateConfig.mutate(localConfig, {
      onSuccess: () => onOpenChange(false),
    });
  };

  const addExcludedSet = () => {
    if (!newExcludedSet.trim()) return;
    const current = (localConfig.excludedSets as string[]) || [];
    if (!current.includes(newExcludedSet.trim())) {
      setLocalConfig({
        ...localConfig,
        excludedSets: [...current, newExcludedSet.trim()],
      });
    }
    setNewExcludedSet('');
  };

  const removeExcludedSet = (set: string) => {
    setLocalConfig({
      ...localConfig,
      excludedSets: ((localConfig.excludedSets as string[]) || []).filter((s) => s !== set),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Auction Sniper Configuration</DialogTitle>
          <DialogDescription>
            Configure thresholds, quiet hours, and excluded sets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Scanner Enabled</Label>
            <Switch
              id="enabled"
              checked={localConfig.enabled as boolean}
              onCheckedChange={(checked: boolean) =>
                setLocalConfig({ ...localConfig, enabled: checked })
              }
            />
          </div>

          {/* Margin Thresholds */}
          <div className="space-y-3">
            <h4 className="font-medium">Margin Thresholds</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="minMargin">Min Margin %</Label>
                <Input
                  id="minMargin"
                  type="number"
                  value={localConfig.minMarginPercent as number}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, minMarginPercent: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="greatMargin">Great Margin %</Label>
                <Input
                  id="greatMargin"
                  type="number"
                  value={localConfig.greatMarginPercent as number}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, greatMarginPercent: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="minProfit">Min Profit (£)</Label>
                <Input
                  id="minProfit"
                  type="number"
                  step="0.50"
                  value={localConfig.minProfitGbp as number}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, minProfitGbp: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="defaultPostage">Default Postage (£)</Label>
                <Input
                  id="defaultPostage"
                  type="number"
                  step="0.01"
                  value={localConfig.defaultPostageGbp as number}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, defaultPostageGbp: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <h4 className="font-medium">Filters</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="minBids">Min Bids</Label>
                <Input
                  id="minBids"
                  type="number"
                  value={localConfig.minBids as number}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, minBids: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="maxBidPrice">Max Bid Price (£)</Label>
                <Input
                  id="maxBidPrice"
                  type="number"
                  placeholder="No limit"
                  value={(localConfig.maxBidPriceGbp as number) || ''}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      maxBidPriceGbp: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="maxSalesRank">Max Sales Rank</Label>
                <Input
                  id="maxSalesRank"
                  type="number"
                  placeholder="No limit"
                  value={(localConfig.maxSalesRank as number) || ''}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      maxSalesRank: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="scanWindow">Scan Window (min)</Label>
                <Input
                  id="scanWindow"
                  type="number"
                  value={localConfig.scanWindowMinutes as number}
                  onChange={(e) =>
                    setLocalConfig({ ...localConfig, scanWindowMinutes: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          </div>

          {/* Quiet Hours */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Quiet Hours (UTC)</h4>
              <Switch
                checked={localConfig.quietHoursEnabled as boolean}
                onCheckedChange={(checked: boolean) =>
                  setLocalConfig({ ...localConfig, quietHoursEnabled: checked })
                }
              />
            </div>
            {(localConfig.quietHoursEnabled as boolean) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="quietStart">Start Hour</Label>
                  <Input
                    id="quietStart"
                    type="number"
                    min={0}
                    max={23}
                    value={localConfig.quietHoursStart as number}
                    onChange={(e) =>
                      setLocalConfig({ ...localConfig, quietHoursStart: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="quietEnd">End Hour</Label>
                  <Input
                    id="quietEnd"
                    type="number"
                    min={0}
                    max={23}
                    value={localConfig.quietHoursEnd as number}
                    onChange={(e) =>
                      setLocalConfig({ ...localConfig, quietHoursEnd: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Joblot Settings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Joblot Analysis</h4>
              <Switch
                checked={localConfig.joblotAnalysisEnabled as boolean}
                onCheckedChange={(checked: boolean) =>
                  setLocalConfig({ ...localConfig, joblotAnalysisEnabled: checked })
                }
              />
            </div>
            {(localConfig.joblotAnalysisEnabled as boolean) && (
              <div>
                <Label htmlFor="joblotMinValue">Min Total Value (£)</Label>
                <Input
                  id="joblotMinValue"
                  type="number"
                  value={localConfig.joblotMinTotalValueGbp as number}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      joblotMinTotalValueGbp: Number(e.target.value),
                    })
                  }
                />
              </div>
            )}
          </div>

          {/* Excluded Sets */}
          <div className="space-y-3">
            <h4 className="font-medium">Excluded Sets</h4>
            <div className="flex gap-2">
              <Input
                placeholder="Set number (e.g. 75192)"
                value={newExcludedSet}
                onChange={(e) => setNewExcludedSet(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExcludedSet()}
              />
              <Button variant="outline" size="icon" onClick={addExcludedSet}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {((localConfig.excludedSets as string[]) || []).map((set) => (
                <Badge key={set} variant="secondary" className="gap-1">
                  {set}
                  <button onClick={() => removeExcludedSet(set)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {((localConfig.excludedSets as string[]) || []).length === 0 && (
                <p className="text-sm text-muted-foreground">No excluded sets</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Main Page
// ============================================

export default function EbayAuctionsPage() {
  const [configOpen, setConfigOpen] = useState(false);
  const { data: statusData } = useAuctionStatus();
  const triggerScan = useTriggerScan();

  const handleManualScan = useCallback(() => {
    triggerScan.mutate();
  }, [triggerScan]);

  const config = statusData?.config;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Gavel className="h-8 w-8" />
            eBay Auction Sniper
          </h1>
          <p className="text-muted-foreground">
            Monitors eBay LEGO auctions ending soon for Amazon arbitrage opportunities
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleManualScan}
            disabled={triggerScan.isPending}
          >
            {triggerScan.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run Scan
          </Button>
          <Button variant="outline" onClick={() => setConfigOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Config
          </Button>
        </div>
      </div>

      {/* Status Cards */}
      <StatusCards data={statusData} />

      {/* Manual scan result feedback */}
      {triggerScan.isSuccess && (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <TrendingUp className="h-4 w-4" />
              <span>
                Scan complete: {String((triggerScan.data as Record<string, unknown>)?.auctionsFound ?? 0)}{' '}
                auctions found, {String((triggerScan.data as Record<string, unknown>)?.opportunitiesFound ?? 0)}{' '}
                opportunities, {String((triggerScan.data as Record<string, unknown>)?.alertsSent ?? 0)}{' '}
                alerts sent
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {triggerScan.isError && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <span>Scan failed: {(triggerScan.error as Error)?.message}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabbed Content */}
      <Tabs defaultValue="alerts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="alerts">Recent Alerts</TabsTrigger>
          <TabsTrigger value="history">Scan History</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>

        <TabsContent value="history">
          <ScanHistoryTab recentScans={statusData?.recentScans || []} />
        </TabsContent>
      </Tabs>

      {/* Config Dialog */}
      {config && (
        <ConfigDialog
          config={{
            enabled: config.enabled,
            minMarginPercent: Number(config.min_margin_percent),
            greatMarginPercent: Number(config.great_margin_percent),
            minProfitGbp: Number(config.min_profit_gbp),
            maxBidPriceGbp: config.max_bid_price_gbp ? Number(config.max_bid_price_gbp) : null,
            defaultPostageGbp: Number(config.default_postage_gbp),
            quietHoursEnabled: config.quiet_hours_enabled,
            quietHoursStart: config.quiet_hours_start,
            quietHoursEnd: config.quiet_hours_end,
            excludedSets: config.excluded_sets || [],
            scanWindowMinutes: config.scan_window_minutes,
            minBids: config.min_bids,
            maxSalesRank: config.max_sales_rank,
            joblotAnalysisEnabled: config.joblot_analysis_enabled,
            joblotMinTotalValueGbp: Number(config.joblot_min_total_value_gbp),
          }}
          open={configOpen}
          onOpenChange={setConfigOpen}
        />
      )}
    </div>
  );
}
