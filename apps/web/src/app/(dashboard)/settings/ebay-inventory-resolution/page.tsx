'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  Search,
  SkipForward,
  X,
  RefreshCw,
  MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Progress } from '@/components/ui/progress';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface MatchCandidate {
  id: string;
  sku: string | null;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  storage_location: string | null;
  list_price: number | null;
  cost: number | null;
  purchase_date: string | null;
  status: string;
  score: number;
  reasons: string[];
}

interface QueueItem {
  id: string;
  sku: string | null;
  title: string;
  quantity: number;
  total_amount: number;
  order_date: string;
  status: string;
  resolution_reason: string;
  match_candidates: MatchCandidate[] | null;
  quantity_needed: number;
  created_at: string;
  ebay_order_id: string;
  ebay_orders: {
    ebay_order_id: string;
    buyer_username: string;
  };
}

interface InventoryItem {
  id: string;
  sku: string | null;
  set_number: string | null;
  item_name: string | null;
  storage_location: string | null;
  status: string;
  cost: number | null;
}

interface QueueResponse {
  data: QueueItem[];
  stats: {
    pending: number;
    resolved: number;
  };
}

interface ProcessHistoricalResult {
  success: boolean;
  data: {
    ordersProcessed: number;
    ordersComplete: number;
    ordersPartial: number;
    ordersPending: number;
    totalAutoLinked: number;
    totalQueuedForResolution: number;
    errors: string[];
  };
}

interface ProgressState {
  current: number;
  total: number;
  autoLinked: number;
  queued: number;
}

// API Functions
async function fetchQueue(): Promise<QueueResponse> {
  const response = await fetch('/api/ebay/resolution-queue');
  if (!response.ok) throw new Error('Failed to fetch resolution queue');
  return response.json();
}

async function resolveItem(id: string, inventoryItemIds: string[]): Promise<void> {
  const response = await fetch(`/api/ebay/resolution-queue/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemIds }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to resolve item');
  }
}

async function skipItem(id: string, reason: 'skipped' | 'no_inventory'): Promise<void> {
  const response = await fetch(`/api/ebay/resolution-queue/${id}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to skip item');
  }
}

async function processHistoricalWithProgress(
  includeSold: boolean,
  onProgress: (progress: ProgressState) => void
): Promise<ProcessHistoricalResult['data']> {
  const response = await fetch('/api/ebay/inventory-linking/process-historical', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeSold }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to process historical orders');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const json = line.slice(6);
        try {
          const data = JSON.parse(json);
          if (data.type === 'progress') {
            onProgress({
              current: data.current,
              total: data.total,
              autoLinked: data.autoLinked,
              queued: data.queued,
            });
          } else if (data.type === 'complete') {
            return data.data;
          } else if (data.type === 'error') {
            throw new Error(data.error);
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  throw new Error('Stream ended without completion');
}

async function searchInventory(query: string, includeSold: boolean = false): Promise<{ data: InventoryItem[] }> {
  const statusParam = includeSold ? '' : '&status=Available';
  const response = await fetch(`/api/inventory?search=${encodeURIComponent(query)}&pageSize=20${statusParam}`);
  if (!response.ok) throw new Error('Failed to search inventory');
  return response.json();
}

function getReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    no_sku: 'No SKU on eBay listing',
    no_matches: 'No matching inventory found',
    multiple_sku_matches: 'Multiple items match SKU',
    fuzzy_set_number: 'Set number match (needs confirmation)',
    fuzzy_title: 'Title match (needs confirmation)',
    multi_quantity: 'Multiple quantity order',
  };
  return labels[reason] || reason;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function EbayInventoryResolutionPage() {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<string[]>([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [includeSoldItems, setIncludeSoldItems] = useState(false);
  const [includeSoldForHistorical, setIncludeSoldForHistorical] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [processingResult, setProcessingResult] = useState<ProcessHistoricalResult['data'] | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Queries
  const { data: queueData, isLoading: loadingQueue } = useQuery({
    queryKey: ['ebay', 'resolution-queue'],
    queryFn: fetchQueue,
  });

  // Mutations
  const resolveMutation = useMutation({
    mutationFn: ({ id, inventoryItemIds }: { id: string; inventoryItemIds: string[] }) =>
      resolveItem(id, inventoryItemIds),
    onSuccess: () => {
      setMessage({ type: 'success', text: 'Item resolved successfully' });
      setSelectedItem(null);
      setSelectedInventoryIds([]);
      queryClient.invalidateQueries({ queryKey: ['ebay', 'resolution-queue'] });
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message });
    },
  });

  const skipMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: 'skipped' | 'no_inventory' }) =>
      skipItem(id, reason),
    onSuccess: () => {
      setMessage({ type: 'success', text: 'Item skipped' });
      setSelectedItem(null);
      queryClient.invalidateQueries({ queryKey: ['ebay', 'resolution-queue'] });
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message });
    },
  });

  const handleProcessHistorical = async () => {
    setIsProcessing(true);
    setProgress(null);
    setProcessingResult(null);
    setMessage(null);

    try {
      const result = await processHistoricalWithProgress(includeSoldForHistorical, setProgress);
      setMessage({ type: 'success', text: 'Historical orders processed' });
      setProcessingResult(result);
      queryClient.invalidateQueries({ queryKey: ['ebay', 'resolution-queue'] });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const handleOpenResolution = (item: QueueItem) => {
    setSelectedItem(item);
    setSelectedInventoryIds([]);
    setInventorySearch('');
    setSearchResults([]);
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchInventory(query, includeSoldItems);
      setSearchResults(result.data || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectCandidate = (candidateId: string) => {
    if (!selectedItem) return;

    if (selectedItem.quantity_needed === 1) {
      // Single quantity - just select and resolve
      resolveMutation.mutate({ id: selectedItem.id, inventoryItemIds: [candidateId] });
    } else {
      // Multi-quantity - toggle selection
      setSelectedInventoryIds((prev) => {
        if (prev.includes(candidateId)) {
          return prev.filter((id) => id !== candidateId);
        }
        if (prev.length < selectedItem.quantity_needed) {
          return [...prev, candidateId];
        }
        return prev;
      });
    }
  };

  const handleConfirmMultiSelect = () => {
    if (!selectedItem || selectedInventoryIds.length !== selectedItem.quantity_needed) return;
    resolveMutation.mutate({ id: selectedItem.id, inventoryItemIds: selectedInventoryIds });
  };

  const handleSkip = (reason: 'skipped' | 'no_inventory') => {
    if (!selectedItem) return;
    skipMutation.mutate({ id: selectedItem.id, reason });
  };

  const queueItems = queueData?.data || [];
  const stats = queueData?.stats || { pending: 0, resolved: 0 };

  return (
    <>
      <Header title="eBay Inventory Resolution" />
      <div className="p-6 space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">eBay Inventory Resolution</h2>
            <p className="text-muted-foreground">
              Link eBay sales to your inventory items
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              onClick={handleProcessHistorical}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Process Historical Orders
            </Button>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="includeSoldHistorical"
                checked={includeSoldForHistorical}
                onChange={(e) => setIncludeSoldForHistorical(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
                disabled={isProcessing}
              />
              <label htmlFor="includeSoldHistorical" className="text-sm text-muted-foreground">
                Include already-sold items (for legacy data)
              </label>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {isProcessing && progress && (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Processing orders...</span>
                  <span className="text-muted-foreground">
                    {progress.current} of {progress.total}
                  </span>
                </div>
                <Progress value={(progress.current / progress.total) * 100} />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Auto-linked: {progress.autoLinked}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-yellow-600" />
                    Queued: {progress.queued}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {message && (
          <Alert
            className={message.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
            variant={message.type === 'error' ? 'destructive' : undefined}
          >
            {message.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
            <AlertDescription className={message.type === 'success' ? 'text-green-800' : undefined}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {processingResult && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Processing Complete
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Orders Processed</p>
                  <p className="text-2xl font-bold">{processingResult.ordersProcessed}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Auto-Linked</p>
                  <p className="text-2xl font-bold text-green-600">{processingResult.totalAutoLinked}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Queued for Resolution</p>
                  <p className="text-2xl font-bold text-yellow-600">{processingResult.totalQueuedForResolution}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Complete Orders</p>
                  <p className="text-2xl font-bold">{processingResult.ordersComplete}</p>
                </div>
              </div>
              {processingResult.errors.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-destructive">Errors: {processingResult.errors.length}</p>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setProcessingResult(null)}
              >
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-100 rounded-full">
                  <Clock className="h-6 w-6 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Resolution</p>
                  <p className="text-3xl font-bold">{stats.pending}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-full">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Resolved</p>
                  <p className="text-3xl font-bold">{stats.resolved}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Queue Items */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <div>
                <CardTitle>Items Needing Resolution</CardTitle>
                <CardDescription>
                  These eBay sales could not be automatically linked to inventory
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingQueue ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : queueItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-600" />
                <p className="font-medium">All items resolved!</p>
                <p className="text-sm">No eBay sales need inventory linking.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queueItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(item.order_date)}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[300px]">
                          <p className="truncate font-medium">{item.title}</p>
                          {item.sku && (
                            <p className="text-xs text-muted-foreground font-mono">
                              SKU: {item.sku}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{item.quantity}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.total_amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {getReasonLabel(item.resolution_reason)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => handleOpenResolution(item)}>
                          <Package className="h-4 w-4 mr-1" />
                          Resolve
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Resolution Dialog */}
        <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Link to Inventory</DialogTitle>
              <DialogDescription>
                Select the inventory item{selectedItem?.quantity_needed && selectedItem.quantity_needed > 1 ? 's' : ''} that was sold
              </DialogDescription>
            </DialogHeader>

            {selectedItem && (
              <div className="space-y-4">
                {/* Sale Details */}
                <div className="bg-muted p-4 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">eBay Order</p>
                      <p className="font-medium">{selectedItem.ebay_orders.ebay_order_id}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Order Date</p>
                      <p className="font-medium">{formatDate(selectedItem.order_date)}</p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-sm text-muted-foreground">Item Title</p>
                    <p className="font-medium">{selectedItem.title}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-2">
                    <div>
                      <p className="text-sm text-muted-foreground">SKU</p>
                      <p className="font-mono text-sm">{selectedItem.sku || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Quantity</p>
                      <p className="font-medium">{selectedItem.quantity}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Sale Amount</p>
                      <p className="font-medium">{formatCurrency(selectedItem.total_amount)}</p>
                    </div>
                  </div>
                </div>

                {/* Multi-quantity progress */}
                {selectedItem.quantity_needed > 1 && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>
                        Select {selectedItem.quantity_needed} inventory items
                      </span>
                      <span>
                        {selectedInventoryIds.length} / {selectedItem.quantity_needed} selected
                      </span>
                    </div>
                    <Progress
                      value={(selectedInventoryIds.length / selectedItem.quantity_needed) * 100}
                    />
                  </div>
                )}

                {/* Match Candidates */}
                {selectedItem.match_candidates && selectedItem.match_candidates.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Suggested Matches</h4>
                    <div className="border rounded-lg max-h-[250px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead className="text-center">Score</TableHead>
                            <TableHead className="w-[80px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedItem.match_candidates.map((candidate) => (
                            <TableRow
                              key={candidate.id}
                              className={
                                selectedInventoryIds.includes(candidate.id)
                                  ? 'bg-green-50'
                                  : undefined
                              }
                            >
                              <TableCell>
                                <div>
                                  <p className="font-medium">{candidate.item_name || candidate.sku || '-'}</p>
                                  {candidate.set_number && (
                                    <p className="text-xs text-muted-foreground">
                                      Set: {candidate.set_number}
                                    </p>
                                  )}
                                  {candidate.condition && (
                                    <Badge variant="outline" className="text-xs mt-1">
                                      {candidate.condition}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {candidate.storage_location ? (
                                  <div className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3 text-muted-foreground" />
                                    <span className="text-sm">{candidate.storage_location}</span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  variant={candidate.score >= 50 ? 'default' : 'secondary'}
                                  className={candidate.score >= 75 ? 'bg-green-600' : undefined}
                                >
                                  {candidate.score}%
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant={
                                    selectedInventoryIds.includes(candidate.id)
                                      ? 'default'
                                      : 'outline'
                                  }
                                  onClick={() => handleSelectCandidate(candidate.id)}
                                  disabled={resolveMutation.isPending}
                                >
                                  {resolveMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : selectedInventoryIds.includes(candidate.id) ? (
                                    <CheckCircle2 className="h-4 w-4" />
                                  ) : (
                                    'Select'
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Manual Search */}
                <div>
                  <h4 className="font-medium mb-2">Search Inventory</h4>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by SKU, set number, or name..."
                        value={inventorySearch}
                        onChange={(e) => setInventorySearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleSearch(inventorySearch);
                          }
                        }}
                        className="pl-10"
                      />
                    </div>
                    <Button onClick={() => handleSearch(inventorySearch)} disabled={isSearching}>
                      {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      id="includeSold"
                      checked={includeSoldItems}
                      onChange={(e) => setIncludeSoldItems(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor="includeSold" className="text-sm text-muted-foreground">
                      Include already-sold items (for linking legacy data)
                    </label>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="border rounded-lg mt-2 max-h-[200px] overflow-y-auto">
                      <Table>
                        <TableBody>
                          {searchResults.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{item.item_name || item.sku || '-'}</p>
                                  {item.set_number && (
                                    <p className="text-xs text-muted-foreground">
                                      Set: {item.set_number}
                                    </p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {item.storage_location || '-'}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant={
                                    selectedInventoryIds.includes(item.id) ? 'default' : 'outline'
                                  }
                                  onClick={() => handleSelectCandidate(item.id)}
                                  disabled={resolveMutation.isPending}
                                >
                                  {selectedInventoryIds.includes(item.id) ? (
                                    <CheckCircle2 className="h-4 w-4" />
                                  ) : (
                                    'Select'
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-between pt-4 border-t">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleSkip('skipped')}
                      disabled={skipMutation.isPending}
                    >
                      <SkipForward className="h-4 w-4 mr-1" />
                      Skip
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleSkip('no_inventory')}
                      disabled={skipMutation.isPending}
                    >
                      No Inventory
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setSelectedItem(null)}>
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                    {selectedItem.quantity_needed > 1 && (
                      <Button
                        onClick={handleConfirmMultiSelect}
                        disabled={
                          selectedInventoryIds.length !== selectedItem.quantity_needed ||
                          resolveMutation.isPending
                        }
                      >
                        {resolveMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                        )}
                        Confirm Selection
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
