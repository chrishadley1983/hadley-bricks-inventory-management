'use client';

import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import {
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Database,
  Zap,
  Filter,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  XCircle,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import type { DiscoverySummary, SeededAsinWithBrickset } from '@/lib/arbitrage/types';

interface SeededAsinFilters {
  search?: string;
  theme?: string;
  yearFrom?: number;
  yearTo?: number;
  minConfidence?: number;
  status?: string;
  includeEnabledOnly?: boolean;
  page: number;
  pageSize: number;
}

const DEFAULT_FILTERS: SeededAsinFilters = {
  page: 1,
  pageSize: 50,
};

export function SeededAsinManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<SeededAsinFilters>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);
  const [discoveryLimit, setDiscoveryLimit] = useState<string>('0');
  const [resolutionDialogOpen, setResolutionDialogOpen] = useState(false);
  const [itemToResolve, setItemToResolve] = useState<SeededAsinWithBrickset | null>(null);
  const [selectedAsinOption, setSelectedAsinOption] = useState<string>('');

  // Debounced search
  const debouncedSearch = useDebouncedCallback((value: string) => {
    setFilters((f) => ({ ...f, search: value || undefined, page: 1 }));
  }, 300);

  // Fetch discovery summary
  const { data: discoveryStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['seeded-discovery-status'],
    queryFn: async () => {
      const response = await fetch('/api/arbitrage/discovery');
      if (!response.ok) throw new Error('Failed to fetch discovery status');
      return response.json() as Promise<{
        summary: DiscoverySummary;
        syncStatus: {
          status: string;
          lastRunAt: string | null;
          itemsProcessed: number;
          totalItems: number | null;
          errorMessage: string | null;
        } | null;
      }>;
    },
    // Poll faster when discovery is running
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.syncStatus?.status === 'running' ? 2000 : 30000;
    },
  });

  // Fetch seeded ASINs list
  const { data: seededData, isLoading: listLoading } = useQuery({
    queryKey: ['seeded-asins', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.theme) params.set('theme', filters.theme);
      if (filters.yearFrom) params.set('yearFrom', String(filters.yearFrom));
      if (filters.yearTo) params.set('yearTo', String(filters.yearTo));
      if (filters.minConfidence) params.set('minConfidence', String(filters.minConfidence));
      if (filters.status) params.set('status', filters.status);
      if (filters.includeEnabledOnly) params.set('includeEnabledOnly', 'true');
      params.set('page', String(filters.page));
      params.set('pageSize', String(filters.pageSize));

      const response = await fetch(`/api/arbitrage/seeded?${params}`);
      if (!response.ok) throw new Error('Failed to fetch seeded ASINs');
      return response.json() as Promise<{
        items: SeededAsinWithBrickset[];
        totalCount: number;
        page: number;
        pageSize: number;
        hasMore: boolean;
      }>;
    },
  });

  // Initialize mutation
  const initializeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/arbitrage/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'initialize' }),
      });
      if (!response.ok) throw new Error('Failed to initialize');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Initialization complete',
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['seeded-discovery-status'] });
      queryClient.invalidateQueries({ queryKey: ['seeded-asins'] });
    },
    onError: (error) => {
      toast({
        title: 'Initialization failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Run discovery mutation
  const runDiscoveryMutation = useMutation({
    mutationFn: async (limit: number = 1000) => {
      const response = await fetch('/api/arbitrage/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', limit }),
      });
      if (!response.ok) throw new Error('Failed to run discovery');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Discovery complete',
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['seeded-discovery-status'] });
      queryClient.invalidateQueries({ queryKey: ['seeded-asins'] });
    },
    onError: (error) => {
      toast({
        title: 'Discovery failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Toggle sync preference mutation
  const toggleSyncMutation = useMutation({
    mutationFn: async ({
      seededAsinIds,
      includeInSync,
    }: {
      seededAsinIds: string[];
      includeInSync: boolean;
    }) => {
      const response = await fetch('/api/arbitrage/seeded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seededAsinIds, includeInSync }),
      });
      if (!response.ok) throw new Error('Failed to update preferences');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seeded-asins'] });
      setSelectedIds(new Set());
    },
    onError: (error) => {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Select ASIN mutation (for resolving multiple matches)
  const selectAsinMutation = useMutation({
    mutationFn: async ({ id, selectedAsin }: { id: string; selectedAsin: string }) => {
      const response = await fetch(`/api/arbitrage/seeded/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select_asin', selectedAsin }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to select ASIN');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'ASIN selected',
        description: 'The ASIN has been confirmed for this set.',
      });
      queryClient.invalidateQueries({ queryKey: ['seeded-asins'] });
      queryClient.invalidateQueries({ queryKey: ['seeded-discovery-status'] });
      setResolutionDialogOpen(false);
      setItemToResolve(null);
      setSelectedAsinOption('');
    },
    onError: (error) => {
      toast({
        title: 'Selection failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Mark as not found mutation
  const markNotFoundMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/arbitrage/seeded/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_not_found' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to mark as not found');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Marked as not found',
        description: 'This set has been marked as not found on Amazon.',
      });
      queryClient.invalidateQueries({ queryKey: ['seeded-asins'] });
      queryClient.invalidateQueries({ queryKey: ['seeded-discovery-status'] });
      setResolutionDialogOpen(false);
      setItemToResolve(null);
    },
    onError: (error) => {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Handlers
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      debouncedSearch(value);
    },
    [debouncedSearch]
  );

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (seededData?.items) {
      if (selectedIds.size === seededData.items.length) {
        setSelectedIds(new Set());
      } else {
        setSelectedIds(new Set(seededData.items.map((i) => i.id)));
      }
    }
  };

  const handleBulkToggleSync = (includeInSync: boolean) => {
    if (selectedIds.size === 0) return;
    toggleSyncMutation.mutate({
      seededAsinIds: Array.from(selectedIds),
      includeInSync,
    });
  };

  const handleOpenResolutionDialog = (item: SeededAsinWithBrickset) => {
    setItemToResolve(item);
    // Pre-select the current ASIN if exists
    setSelectedAsinOption(item.asin ?? '');
    setResolutionDialogOpen(true);
  };

  const handleConfirmAsinSelection = () => {
    if (!itemToResolve || !selectedAsinOption) return;
    selectAsinMutation.mutate({
      id: itemToResolve.id,
      selectedAsin: selectedAsinOption,
    });
  };

  const handleMarkNotFound = () => {
    if (!itemToResolve) return;
    markNotFoundMutation.mutate(itemToResolve.id);
  };

  const handleExportCsv = async (type: 'multiples' | 'not-found') => {
    try {
      const endpoint =
        type === 'multiples'
          ? '/api/arbitrage/seeded/export-multiples'
          : '/api/arbitrage/seeded/export-not-found';

      const response = await fetch(endpoint);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed');
      }

      // Get the filename from the response header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const defaultFilename =
        type === 'multiples'
          ? `seeded-multiples-${new Date().toISOString().split('T')[0]}.csv`
          : `seeded-not-found-${new Date().toISOString().split('T')[0]}.csv`;
      const filename = filenameMatch?.[1] || defaultFilename;

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: 'Export complete',
        description: `${type === 'multiples' ? 'Multiple matches' : 'Not found items'} CSV has been downloaded.`,
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const summary = discoveryStatus?.summary;
  const syncStatus = discoveryStatus?.syncStatus;
  const isRunning = syncStatus?.status === 'running';

  return (
    <div className="space-y-6">
      {/* Discovery Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {statusLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatusCard
              label="Total Sets"
              value={summary?.total ?? 0}
              icon={<Database className="h-4 w-4" />}
            />
            <StatusCard
              label="Pending"
              value={summary?.pending ?? 0}
              icon={<Clock className="h-4 w-4" />}
              className="text-amber-600"
            />
            <StatusCard
              label="Found"
              value={summary?.found ?? 0}
              subtext={`${summary?.foundPercent ?? 0}%`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              className="text-green-600"
            />
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-red-600">
                    <AlertCircle className="h-4 w-4" />
                  </span>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
                    Not Found
                  </span>
                  {(summary?.notFound ?? 0) > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 ml-auto"
                      onClick={() => handleExportCsv('not-found')}
                      title="Export not found to CSV"
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="text-2xl font-bold text-red-600">{summary?.notFound ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-purple-600">
                    <AlertCircle className="h-4 w-4" />
                  </span>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
                    Multiple
                  </span>
                  {(summary?.multiple ?? 0) > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 ml-auto"
                      onClick={() => handleExportCsv('multiples')}
                      title="Export multiples to CSV"
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="text-2xl font-bold text-purple-600">{summary?.multiple ?? 0}</div>
              </CardContent>
            </Card>
            <StatusCard
              label="Avg Confidence"
              value={summary?.avgConfidence ? `${summary.avgConfidence}%` : '—'}
              icon={<Zap className="h-4 w-4" />}
            />
          </>
        )}
      </div>

      {/* Action Buttons */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Discovery Actions</CardTitle>
              <CardDescription>
                Initialize seeded ASINs from Brickset or run ASIN discovery
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => initializeMutation.mutate()}
                disabled={initializeMutation.isPending || isRunning}
              >
                <Database className="mr-2 h-4 w-4" />
                Initialize
              </Button>
              <Button
                onClick={() => {
                  // Set default to pending count (or 0 for "all")
                  setDiscoveryLimit('0');
                  setDiscoveryDialogOpen(true);
                }}
                disabled={runDiscoveryMutation.isPending || isRunning}
              >
                {isRunning ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-4 w-4" />
                )}
                Run Discovery
              </Button>
            </div>
          </div>
        </CardHeader>
        {isRunning && (
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>
                  {syncStatus?.errorMessage?.startsWith('Processing:')
                    ? syncStatus.errorMessage
                    : 'Discovery in progress...'}
                </span>
                <span>
                  {syncStatus?.itemsProcessed ?? 0}
                  {syncStatus?.totalItems ? ` / ${syncStatus.totalItems}` : ''} processed
                </span>
              </div>
              <Progress
                value={
                  syncStatus?.totalItems && syncStatus?.itemsProcessed
                    ? (syncStatus.itemsProcessed / syncStatus.totalItems) * 100
                    : 0
                }
                className="h-2"
              />
              {syncStatus?.totalItems && syncStatus?.itemsProcessed ? (
                <div className="text-xs text-muted-foreground text-right">
                  {Math.round((syncStatus.itemsProcessed / syncStatus.totalItems) * 100)}% complete
                </div>
              ) : null}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Filters */}
      <Collapsible open={filtersExpanded} onOpenChange={setFiltersExpanded}>
        <Card>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  <CardTitle className="text-base">Filters</CardTitle>
                </div>
                {filtersExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Search */}
                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1.5 block">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Set number, name, or ASIN..."
                      value={searchInput}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                {/* Status Filter */}
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Status</label>
                  <Select
                    value={filters.status ?? 'all'}
                    onValueChange={(v: string) =>
                      setFilters((f) => ({
                        ...f,
                        status: v === 'all' ? undefined : v,
                        page: 1,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="found">Found</SelectItem>
                      <SelectItem value="not_found">Not Found</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="multiple">Multiple Matches</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Min Confidence */}
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Min Confidence</label>
                  <Select
                    value={String(filters.minConfidence ?? 0)}
                    onValueChange={(v: string) =>
                      setFilters((f) => ({
                        ...f,
                        minConfidence: v === '0' ? undefined : Number(v),
                        page: 1,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any</SelectItem>
                      <SelectItem value="60">60%+</SelectItem>
                      <SelectItem value="75">75%+</SelectItem>
                      <SelectItem value="85">85%+ (Exact)</SelectItem>
                      <SelectItem value="95">95%+ (EAN/UPC)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkToggleSync(true)}
            disabled={toggleSyncMutation.isPending}
          >
            Enable Sync
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulkToggleSync(false)}
            disabled={toggleSyncMutation.isPending}
          >
            Disable Sync
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      {/* Seeded ASINs Table */}
      <Card>
        <CardContent className="p-0">
          {listLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (seededData?.items?.length ?? 0) === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No seeded ASINs found</p>
              <p className="text-sm mt-1">
                Try initializing from Brickset or adjusting your filters
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left w-10">
                      <Checkbox
                        checked={seededData?.items && selectedIds.size === seededData.items.length}
                        onCheckedChange={handleSelectAll}
                      />
                    </th>
                    <th className="px-4 py-3 text-left">Set</th>
                    <th className="px-4 py-3 text-left">ASIN</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Confidence</th>
                    <th className="px-4 py-3 text-right">RRP</th>
                    <th className="px-4 py-3 text-center">Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {seededData?.items.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        'border-b hover:bg-muted/30',
                        selectedIds.has(item.id) && 'bg-purple-50 dark:bg-purple-950/20'
                      )}
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => handleToggleSelect(item.id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium">{item.bricksetSet.setNumber}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {item.bricksetSet.setName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.bricksetSet.theme} ({item.bricksetSet.yearFrom})
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {item.asin ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            {item.asin}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.discoveryStatus === 'multiple' || item.discoveryStatus === 'found' ? (
                          <button
                            onClick={() => handleOpenResolutionDialog(item)}
                            className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer"
                            title={
                              item.discoveryStatus === 'multiple'
                                ? 'Click to resolve multiple matches'
                                : 'Click to change or mark as not found'
                            }
                          >
                            <StatusBadge status={item.discoveryStatus} />
                            {item.discoveryStatus === 'multiple' && (
                              <span className="text-xs text-purple-600">
                                ({(item.alternativeAsins?.length ?? 0) + (item.asin ? 1 : 0)})
                              </span>
                            )}
                          </button>
                        ) : (
                          <StatusBadge status={item.discoveryStatus} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.matchConfidence != null ? (
                          <ConfidenceBadge confidence={item.matchConfidence} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {item.bricksetSet.ukRetailPrice
                          ? formatCurrency(item.bricksetSet.ukRetailPrice, 'GBP')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Checkbox
                          checked={item.userPreference?.includeInSync ?? false}
                          onCheckedChange={(checked: boolean | 'indeterminate') =>
                            toggleSyncMutation.mutate({
                              seededAsinIds: [item.id],
                              includeInSync: !!checked,
                            })
                          }
                          disabled={item.discoveryStatus !== 'found'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {seededData && seededData.totalCount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {(filters.page - 1) * filters.pageSize + 1} to{' '}
                {Math.min(filters.page * filters.pageSize, seededData.totalCount)} of{' '}
                {seededData.totalCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page === 1}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!seededData.hasMore}
                  onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Discovery Limit Dialog */}
      <Dialog open={discoveryDialogOpen} onOpenChange={setDiscoveryDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Run ASIN Discovery</DialogTitle>
            <DialogDescription>
              Set how many sets to process. Enter 0 to process all{' '}
              {summary?.pending.toLocaleString() ?? 0} pending sets. At ~2 seconds per set, 1000
              sets takes about 30 minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="limit" className="text-right">
                Limit
              </Label>
              <Input
                id="limit"
                type="number"
                min={0}
                max={50000}
                value={discoveryLimit}
                onChange={(e) => setDiscoveryLimit(e.target.value)}
                className="col-span-3"
                placeholder="0 = all pending"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <div className="col-span-4 flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setDiscoveryLimit('100')}>
                  100
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDiscoveryLimit('500')}>
                  500
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDiscoveryLimit('1000')}>
                  1,000
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDiscoveryLimit('0')}>
                  All
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscoveryDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const limit = parseInt(discoveryLimit, 10) || 0;
                setDiscoveryDialogOpen(false);
                runDiscoveryMutation.mutate(limit);
              }}
            >
              <Zap className="mr-2 h-4 w-4" />
              Start Discovery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ASIN Resolution Dialog */}
      <Dialog
        open={resolutionDialogOpen}
        onOpenChange={(open: boolean) => {
          setResolutionDialogOpen(open);
          if (!open) {
            setItemToResolve(null);
            setSelectedAsinOption('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {itemToResolve?.discoveryStatus === 'multiple'
                ? 'Resolve Multiple Matches'
                : 'Manage ASIN'}
            </DialogTitle>
            <DialogDescription>
              {itemToResolve && (
                <span className="block mt-1">
                  <span className="font-medium">{itemToResolve.bricksetSet.setNumber}</span> -{' '}
                  {itemToResolve.bricksetSet.setName}
                  {itemToResolve.bricksetSet.theme && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({itemToResolve.bricksetSet.theme}, {itemToResolve.bricksetSet.yearFrom})
                    </span>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {itemToResolve && (
            <div className="space-y-4 py-2">
              {/* ASIN Options */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Available ASINs</Label>
                <RadioGroup
                  value={selectedAsinOption}
                  onValueChange={setSelectedAsinOption}
                  className="space-y-2"
                >
                  {/* Current ASIN (if exists) */}
                  {itemToResolve.asin && (
                    <AsinOptionItem
                      asin={itemToResolve.asin}
                      title={itemToResolve.amazonTitle ?? undefined}
                      confidence={itemToResolve.matchConfidence ?? undefined}
                      isCurrent
                      selected={selectedAsinOption === itemToResolve.asin}
                    />
                  )}

                  {/* Alternative ASINs */}
                  {itemToResolve.alternativeAsins?.map((alt) => (
                    <AsinOptionItem
                      key={alt.asin}
                      asin={alt.asin}
                      title={alt.title}
                      confidence={alt.confidence}
                      selected={selectedAsinOption === alt.asin}
                    />
                  ))}

                  {/* No alternatives available message */}
                  {!itemToResolve.asin &&
                    (!itemToResolve.alternativeAsins ||
                      itemToResolve.alternativeAsins.length === 0) && (
                      <p className="text-sm text-muted-foreground italic">
                        No ASIN options available for this set.
                      </p>
                    )}
                </RadioGroup>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleMarkNotFound}
                  disabled={markNotFoundMutation.isPending || selectAsinMutation.isPending}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Mark as Not Found
                </Button>
                <span className="text-xs text-muted-foreground flex-1">
                  This removes the current ASIN and marks the set as not found on Amazon.
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolutionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAsinSelection}
              disabled={
                !selectedAsinOption ||
                selectAsinMutation.isPending ||
                markNotFoundMutation.isPending
              }
            >
              {selectAsinMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Confirm Selection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ASIN Option Item Component for the resolution dialog
interface AsinOptionItemProps {
  asin: string;
  title?: string;
  confidence?: number;
  isCurrent?: boolean;
  selected: boolean;
}

function AsinOptionItem({ asin, title, confidence, isCurrent, selected }: AsinOptionItemProps) {
  const amazonUrl = `https://www.amazon.co.uk/dp/${asin}`;

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
      )}
    >
      <RadioGroupItem value={asin} id={asin} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Label htmlFor={asin} className="font-mono text-sm cursor-pointer">
            {asin}
          </Label>
          {isCurrent && (
            <Badge variant="secondary" className="text-xs">
              Current
            </Badge>
          )}
          {confidence !== undefined && <ConfidenceBadge confidence={confidence} />}
          <a
            href={amazonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        {title && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{title}</p>}
      </div>
    </div>
  );
}

// Helper Components

interface StatusCardProps {
  label: string;
  value: number | string;
  subtext?: string;
  icon?: React.ReactNode;
  className?: string;
}

function StatusCard({ label, value, subtext, icon, className }: StatusCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {icon && <span className={className}>{icon}</span>}
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <div className={cn('text-2xl font-bold', className)}>{value}</div>
        {subtext && <div className="text-xs text-muted-foreground">{subtext}</div>}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    found: 'bg-green-100 text-green-800',
    not_found: 'bg-red-100 text-red-800',
    pending: 'bg-amber-100 text-amber-800',
    multiple: 'bg-purple-100 text-purple-800',
    excluded: 'bg-gray-100 text-gray-800',
  };

  return (
    <Badge variant="outline" className={cn('text-xs', variants[status])}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const className =
    confidence >= 95
      ? 'bg-green-100 text-green-800'
      : confidence >= 85
        ? 'bg-blue-100 text-blue-800'
        : 'bg-amber-100 text-amber-800';

  return (
    <Badge variant="outline" className={cn('font-mono text-xs', className)}>
      {confidence}%
    </Badge>
  );
}
