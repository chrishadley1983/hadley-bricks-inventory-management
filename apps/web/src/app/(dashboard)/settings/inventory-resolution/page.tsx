'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
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
  ShoppingCart,
} from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// ============================================================================
// Types
// ============================================================================

interface MatchCandidate {
  id: string;
  sku?: string | null;
  amazon_asin?: string | null;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  storage_location: string | null;
  list_price?: number | null;
  listing_value?: number | null;
  cost: number | null;
  purchase_date: string | null;
  created_at?: string;
  status: string;
  score: number;
  reasons: string[];
}

interface EbayQueueItem {
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

interface AmazonQueueItem {
  id: string;
  asin: string | null;
  item_name: string;
  quantity: number;
  total_amount: number;
  order_date: string;
  amazon_order_id: string;
  status: string;
  resolution_reason: string;
  match_candidates: MatchCandidate[] | null;
  quantity_needed: number;
  created_at: string;
  platform_order_id: string;
  platform_orders: {
    id: string;
    platform_order_id: string;
    buyer_name: string | null;
  };
}

interface InventoryItem {
  id: string;
  sku?: string | null;
  amazon_asin?: string | null;
  set_number: string | null;
  item_name: string | null;
  storage_location: string | null;
  status: string;
  cost: number | null;
  sold_date?: string | null;
  linked_order_id?: string | null; // Order ID if already linked
}

interface QueueResponse<T> {
  data: T[];
  stats: {
    pending: number;
    resolved: number;
  };
}

interface ProcessHistoricalResult {
  ordersProcessed: number;
  ordersComplete: number;
  ordersPartial: number;
  ordersPending: number;
  totalAutoLinked: number;
  totalQueuedForResolution: number;
  errors: string[];
}

interface ProgressState {
  current: number;
  total: number;
  autoLinked: number;
  queued: number;
}

// ============================================================================
// API Functions - eBay
// ============================================================================

async function fetchEbayQueue(): Promise<QueueResponse<EbayQueueItem>> {
  const response = await fetch('/api/ebay/resolution-queue');
  if (!response.ok) throw new Error('Failed to fetch eBay resolution queue');
  return response.json();
}

async function resolveEbayItem(id: string, inventoryItemIds: string[]): Promise<void> {
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

async function skipEbayItem(id: string, reason: 'skipped' | 'no_inventory'): Promise<void> {
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

async function processEbayHistoricalWithProgress(
  includeSold: boolean,
  includePaid: boolean,
  onProgress: (progress: ProgressState) => void
): Promise<ProcessHistoricalResult> {
  const response = await fetch('/api/ebay/inventory-linking/process-historical', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeSold, includePaid }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to process historical orders');
  }

  return processStreamResponse(response, onProgress);
}

// ============================================================================
// API Functions - Amazon
// ============================================================================

async function fetchAmazonQueue(): Promise<QueueResponse<AmazonQueueItem>> {
  const response = await fetch('/api/amazon/resolution-queue');
  if (!response.ok) throw new Error('Failed to fetch Amazon resolution queue');
  return response.json();
}

async function resolveAmazonItem(id: string, inventoryItemIds: string[]): Promise<void> {
  const response = await fetch(`/api/amazon/resolution-queue/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemIds }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to resolve item');
  }
}

async function skipAmazonItem(id: string, reason: 'skipped' | 'no_inventory'): Promise<void> {
  const response = await fetch(`/api/amazon/resolution-queue/${id}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to skip item');
  }
}

async function processAmazonHistoricalWithProgress(
  includeSold: boolean,
  onProgress: (progress: ProgressState) => void
): Promise<ProcessHistoricalResult> {
  const response = await fetch('/api/amazon/inventory-linking/process-historical', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeSold, mode: 'auto' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to process historical orders');
  }

  return processStreamResponse(response, onProgress);
}

// ============================================================================
// Shared Functions
// ============================================================================

async function processStreamResponse(
  response: Response,
  onProgress: (progress: ProgressState) => void
): Promise<ProcessHistoricalResult> {
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

async function searchInventory(
  query: string,
  includeSold: boolean = false
): Promise<{ data: InventoryItem[] }> {
  // Use the dedicated search-unlinked endpoint which efficiently excludes linked items
  // using a database function instead of client-side filtering with large ID lists
  const statusParam = includeSold ? '' : '&status=BACKLOG,LISTED';
  const includeSoldParam = includeSold ? '&includeSold=true' : '';
  const response = await fetch(
    `/api/inventory/search-unlinked?search=${encodeURIComponent(query)}&pageSize=20${statusParam}${includeSoldParam}`
  );
  if (!response.ok) throw new Error('Failed to search inventory');
  const result = await response.json();
  // New API returns { data: [...] } directly
  const inventoryItems: InventoryItem[] = result.data || [];

  // If including sold items, check which ones are already linked to orders
  if (includeSold && inventoryItems.length > 0) {
    const linkedResponse = await fetch('/api/inventory/linked-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventoryIds: inventoryItems.map((i) => i.id) }),
    });
    if (linkedResponse.ok) {
      const linkedData = await linkedResponse.json();
      const linkedMap: Record<string, string> = linkedData.data || {};
      // Merge linked order info into inventory items
      for (const item of inventoryItems) {
        item.linked_order_id = linkedMap[item.id] || null;
      }
    }
  }

  return { data: inventoryItems };
}

function getEbayReasonLabel(reason: string): string {
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

function getAmazonReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    no_asin: 'No ASIN in order',
    no_matches: 'No matching inventory found',
    insufficient_inventory: 'Not enough inventory for quantity',
    already_linked: 'Inventory already sold',
    multiple_asin_matches: 'Multiple items match ASIN',
    picklist_mismatch: 'Pick list mismatch',
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

// ============================================================================
// Main Component
// ============================================================================

export default function InventoryResolutionPage() {
  usePerfPage('InventoryResolutionPage');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'ebay' | 'amazon'>('ebay');

  // eBay state
  const [selectedEbayItem, setSelectedEbayItem] = useState<EbayQueueItem | null>(null);
  const [ebaySelectedInventoryIds, setEbaySelectedInventoryIds] = useState<string[]>([]);

  // Amazon state
  const [selectedAmazonItem, setSelectedAmazonItem] = useState<AmazonQueueItem | null>(null);
  const [amazonSelectedInventoryIds, setAmazonSelectedInventoryIds] = useState<string[]>([]);

  // Shared state
  const [inventorySearch, setInventorySearch] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [includeSoldItems, setIncludeSoldItems] = useState(false);
  const [includeSoldForHistorical, setIncludeSoldForHistorical] = useState(false);
  const [includePaidForHistorical, setIncludePaidForHistorical] = useState(true); // Default to true for eBay
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [processingResult, setProcessingResult] = useState<ProcessHistoricalResult | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Queries
  const { data: ebayQueueData, isLoading: loadingEbayQueue } = useQuery({
    queryKey: ['ebay', 'resolution-queue'],
    queryFn: fetchEbayQueue,
  });

  const { data: amazonQueueData, isLoading: loadingAmazonQueue } = useQuery({
    queryKey: ['amazon', 'resolution-queue'],
    queryFn: fetchAmazonQueue,
  });

  // eBay Mutations
  const ebayResolveMutation = useMutation({
    mutationFn: ({ id, inventoryItemIds }: { id: string; inventoryItemIds: string[] }) =>
      resolveEbayItem(id, inventoryItemIds),
    onSuccess: (_data, variables) => {
      setMessage({ type: 'success', text: 'eBay item resolved successfully' });
      setEbaySelectedInventoryIds([]);
      setInventorySearch('');
      setSearchResults([]);
      queryClient.invalidateQueries({ queryKey: ['ebay', 'resolution-queue'] });
      // Auto-advance to next item in queue
      const currentQueue = ebayQueueItems;
      const nextItem = currentQueue.find((item) => item.id !== variables.id);
      setSelectedEbayItem(nextItem || null);
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message });
    },
  });

  const ebaySkipMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: 'skipped' | 'no_inventory' }) =>
      skipEbayItem(id, reason),
    onSuccess: (_data, variables) => {
      setMessage({ type: 'success', text: 'eBay item skipped' });
      queryClient.invalidateQueries({ queryKey: ['ebay', 'resolution-queue'] });
      // Auto-advance to next item in queue
      const currentQueue = ebayQueueItems;
      const nextItem = currentQueue.find((item) => item.id !== variables.id);
      setSelectedEbayItem(nextItem || null);
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message });
    },
  });

  // Amazon Mutations
  const amazonResolveMutation = useMutation({
    mutationFn: ({ id, inventoryItemIds }: { id: string; inventoryItemIds: string[] }) =>
      resolveAmazonItem(id, inventoryItemIds),
    onSuccess: (_data, variables) => {
      setMessage({ type: 'success', text: 'Amazon item resolved successfully' });
      setAmazonSelectedInventoryIds([]);
      setInventorySearch('');
      setSearchResults([]);
      queryClient.invalidateQueries({ queryKey: ['amazon', 'resolution-queue'] });
      // Auto-advance to next item in queue
      const currentQueue = amazonQueueItems;
      const nextItem = currentQueue.find((item) => item.id !== variables.id);
      setSelectedAmazonItem(nextItem || null);
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message });
    },
  });

  const amazonSkipMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: 'skipped' | 'no_inventory' }) =>
      skipAmazonItem(id, reason),
    onSuccess: (_data, variables) => {
      setMessage({ type: 'success', text: 'Amazon item skipped' });
      queryClient.invalidateQueries({ queryKey: ['amazon', 'resolution-queue'] });
      // Auto-advance to next item in queue
      const currentQueue = amazonQueueItems;
      const nextItem = currentQueue.find((item) => item.id !== variables.id);
      setSelectedAmazonItem(nextItem || null);
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
      const result =
        activeTab === 'ebay'
          ? await processEbayHistoricalWithProgress(
              includeSoldForHistorical,
              includePaidForHistorical,
              setProgress
            )
          : await processAmazonHistoricalWithProgress(includeSoldForHistorical, setProgress);

      setMessage({
        type: 'success',
        text: `${activeTab === 'ebay' ? 'eBay' : 'Amazon'} historical orders processed`,
      });
      setProcessingResult(result);
      queryClient.invalidateQueries({ queryKey: [activeTab, 'resolution-queue'] });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
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

  const ebayQueueItems = ebayQueueData?.data || [];
  const ebayStats = ebayQueueData?.stats || { pending: 0, resolved: 0 };
  const amazonQueueItems = amazonQueueData?.data || [];
  const amazonStats = amazonQueueData?.stats || { pending: 0, resolved: 0 };

  return (
    <>
      <Header title="Inventory Resolution" />
      <div className="p-6 space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Inventory Resolution</h2>
            <p className="text-muted-foreground">Link platform sales to your inventory items</p>
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
                  <p className="text-2xl font-bold text-green-600">
                    {processingResult.totalAutoLinked}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Queued for Resolution</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {processingResult.totalQueuedForResolution}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Complete Orders</p>
                  <p className="text-2xl font-bold">{processingResult.ordersComplete}</p>
                </div>
              </div>
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

        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'ebay' | 'amazon')}>
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="ebay" className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              eBay
              {ebayStats.pending > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {ebayStats.pending}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="amazon" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Amazon
              {amazonStats.pending > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {amazonStats.pending}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* eBay Tab */}
          <TabsContent value="ebay" className="space-y-6">
            <div className="flex justify-end">
              <div className="flex flex-col items-end gap-2">
                <Button onClick={handleProcessHistorical} disabled={isProcessing}>
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Process eBay Historical Orders
                </Button>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="includePaidHistoricalEbay"
                    checked={includePaidForHistorical}
                    onChange={(e) => setIncludePaidForHistorical(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                    disabled={isProcessing}
                  />
                  <label
                    htmlFor="includePaidHistoricalEbay"
                    className="text-sm text-muted-foreground"
                  >
                    Include PAID orders (for pre-linking before fulfilment)
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="includeSoldHistoricalEbay"
                    checked={includeSoldForHistorical}
                    onChange={(e) => setIncludeSoldForHistorical(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                    disabled={isProcessing}
                  />
                  <label
                    htmlFor="includeSoldHistoricalEbay"
                    className="text-sm text-muted-foreground"
                  >
                    Include already-sold items (for legacy data)
                  </label>
                </div>
              </div>
            </div>

            {/* eBay Stats */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-yellow-100 rounded-full">
                      <Clock className="h-6 w-6 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Pending Resolution</p>
                      <p className="text-3xl font-bold">{ebayStats.pending}</p>
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
                      <p className="text-3xl font-bold">{ebayStats.resolved}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* eBay Queue */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  <div>
                    <CardTitle>eBay Items Needing Resolution</CardTitle>
                    <CardDescription>
                      These eBay sales could not be automatically linked to inventory
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingEbayQueue ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : ebayQueueItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-600" />
                    <p className="font-medium">All eBay items resolved!</p>
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
                      {ebayQueueItems.map((item) => (
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
                              {getEbayReasonLabel(item.resolution_reason)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button size="sm" onClick={() => setSelectedEbayItem(item)}>
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
          </TabsContent>

          {/* Amazon Tab */}
          <TabsContent value="amazon" className="space-y-6">
            <div className="flex justify-end">
              <div className="flex flex-col items-end gap-2">
                <Button onClick={handleProcessHistorical} disabled={isProcessing}>
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Process Amazon Historical Orders
                </Button>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="includeSoldHistoricalAmazon"
                    checked={includeSoldForHistorical}
                    onChange={(e) => setIncludeSoldForHistorical(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                    disabled={isProcessing}
                  />
                  <label
                    htmlFor="includeSoldHistoricalAmazon"
                    className="text-sm text-muted-foreground"
                  >
                    Include already-sold items (for legacy data)
                  </label>
                </div>
              </div>
            </div>

            {/* Amazon Stats */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-yellow-100 rounded-full">
                      <Clock className="h-6 w-6 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Pending Resolution</p>
                      <p className="text-3xl font-bold">{amazonStats.pending}</p>
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
                      <p className="text-3xl font-bold">{amazonStats.resolved}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Amazon Queue */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  <div>
                    <CardTitle>Amazon Items Needing Resolution</CardTitle>
                    <CardDescription>
                      These Amazon sales could not be automatically linked to inventory
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingAmazonQueue ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : amazonQueueItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-600" />
                    <p className="font-medium">All Amazon items resolved!</p>
                    <p className="text-sm">No Amazon sales need inventory linking.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order Date</TableHead>
                        <TableHead>ASIN</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="w-[100px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {amazonQueueItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(item.order_date)}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs">{item.asin || '-'}</span>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[250px]">
                              <p className="truncate font-medium">{item.item_name}</p>
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
                              {getAmazonReasonLabel(item.resolution_reason)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button size="sm" onClick={() => setSelectedAmazonItem(item)}>
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
          </TabsContent>
        </Tabs>

        {/* eBay Resolution Dialog */}
        <Dialog open={!!selectedEbayItem} onOpenChange={() => setSelectedEbayItem(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Link eBay Sale to Inventory</DialogTitle>
              <DialogDescription>
                Select the inventory item
                {selectedEbayItem?.quantity_needed && selectedEbayItem.quantity_needed > 1
                  ? 's'
                  : ''}{' '}
                that was sold
              </DialogDescription>
            </DialogHeader>

            {selectedEbayItem && (
              <ResolutionDialogContent
                platform="ebay"
                orderId={selectedEbayItem.ebay_orders.ebay_order_id}
                orderDate={selectedEbayItem.order_date}
                title={selectedEbayItem.title}
                identifier={selectedEbayItem.sku}
                identifierLabel="SKU"
                quantity={selectedEbayItem.quantity}
                quantityNeeded={selectedEbayItem.quantity_needed}
                totalAmount={selectedEbayItem.total_amount}
                matchCandidates={selectedEbayItem.match_candidates}
                selectedInventoryIds={ebaySelectedInventoryIds}
                onSelectCandidate={(id) => {
                  if (selectedEbayItem.quantity_needed === 1) {
                    ebayResolveMutation.mutate({ id: selectedEbayItem.id, inventoryItemIds: [id] });
                  } else {
                    setEbaySelectedInventoryIds((prev) => {
                      if (prev.includes(id)) return prev.filter((i) => i !== id);
                      if (prev.length < selectedEbayItem.quantity_needed) return [...prev, id];
                      return prev;
                    });
                  }
                }}
                onConfirmMultiSelect={() => {
                  if (ebaySelectedInventoryIds.length === selectedEbayItem.quantity_needed) {
                    ebayResolveMutation.mutate({
                      id: selectedEbayItem.id,
                      inventoryItemIds: ebaySelectedInventoryIds,
                    });
                  }
                }}
                onSkip={(reason) => ebaySkipMutation.mutate({ id: selectedEbayItem.id, reason })}
                onCancel={() => setSelectedEbayItem(null)}
                inventorySearch={inventorySearch}
                setInventorySearch={setInventorySearch}
                searchResults={searchResults}
                onSearch={handleSearch}
                isSearching={isSearching}
                includeSoldItems={includeSoldItems}
                setIncludeSoldItems={setIncludeSoldItems}
                isResolving={ebayResolveMutation.isPending}
                isSkipping={ebaySkipMutation.isPending}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Amazon Resolution Dialog */}
        <Dialog open={!!selectedAmazonItem} onOpenChange={() => setSelectedAmazonItem(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Link Amazon Sale to Inventory</DialogTitle>
              <DialogDescription>
                Select the inventory item
                {selectedAmazonItem?.quantity_needed && selectedAmazonItem.quantity_needed > 1
                  ? 's'
                  : ''}{' '}
                that was sold
              </DialogDescription>
            </DialogHeader>

            {selectedAmazonItem && (
              <ResolutionDialogContent
                platform="amazon"
                orderId={selectedAmazonItem.amazon_order_id}
                orderDate={selectedAmazonItem.order_date}
                title={selectedAmazonItem.item_name}
                identifier={selectedAmazonItem.asin}
                identifierLabel="ASIN"
                quantity={selectedAmazonItem.quantity}
                quantityNeeded={selectedAmazonItem.quantity_needed}
                totalAmount={selectedAmazonItem.total_amount}
                matchCandidates={selectedAmazonItem.match_candidates}
                selectedInventoryIds={amazonSelectedInventoryIds}
                onSelectCandidate={(id) => {
                  if (selectedAmazonItem.quantity_needed === 1) {
                    amazonResolveMutation.mutate({
                      id: selectedAmazonItem.id,
                      inventoryItemIds: [id],
                    });
                  } else {
                    setAmazonSelectedInventoryIds((prev) => {
                      if (prev.includes(id)) return prev.filter((i) => i !== id);
                      if (prev.length < selectedAmazonItem.quantity_needed) return [...prev, id];
                      return prev;
                    });
                  }
                }}
                onConfirmMultiSelect={() => {
                  if (amazonSelectedInventoryIds.length === selectedAmazonItem.quantity_needed) {
                    amazonResolveMutation.mutate({
                      id: selectedAmazonItem.id,
                      inventoryItemIds: amazonSelectedInventoryIds,
                    });
                  }
                }}
                onSkip={(reason) =>
                  amazonSkipMutation.mutate({ id: selectedAmazonItem.id, reason })
                }
                onCancel={() => setSelectedAmazonItem(null)}
                inventorySearch={inventorySearch}
                setInventorySearch={setInventorySearch}
                searchResults={searchResults}
                onSearch={handleSearch}
                isSearching={isSearching}
                includeSoldItems={includeSoldItems}
                setIncludeSoldItems={setIncludeSoldItems}
                isResolving={amazonResolveMutation.isPending}
                isSkipping={amazonSkipMutation.isPending}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

// ============================================================================
// Resolution Dialog Content Component
// ============================================================================

interface ResolutionDialogContentProps {
  platform: 'ebay' | 'amazon';
  orderId: string;
  orderDate: string;
  title: string;
  identifier: string | null;
  identifierLabel: string;
  quantity: number;
  quantityNeeded: number;
  totalAmount: number;
  matchCandidates: MatchCandidate[] | null;
  selectedInventoryIds: string[];
  onSelectCandidate: (id: string) => void;
  onConfirmMultiSelect: () => void;
  onSkip: (reason: 'skipped' | 'no_inventory') => void;
  onCancel: () => void;
  inventorySearch: string;
  setInventorySearch: (value: string) => void;
  searchResults: InventoryItem[];
  onSearch: (query: string) => void;
  isSearching: boolean;
  includeSoldItems: boolean;
  setIncludeSoldItems: (value: boolean) => void;
  isResolving: boolean;
  isSkipping: boolean;
}

function ResolutionDialogContent({
  platform,
  orderId,
  orderDate,
  title,
  identifier,
  identifierLabel,
  quantity,
  quantityNeeded,
  totalAmount,
  matchCandidates,
  selectedInventoryIds,
  onSelectCandidate,
  onConfirmMultiSelect,
  onSkip,
  onCancel,
  inventorySearch,
  setInventorySearch,
  searchResults,
  onSearch,
  isSearching,
  includeSoldItems,
  setIncludeSoldItems,
  isResolving,
  isSkipping,
}: ResolutionDialogContentProps) {
  // Track which match candidates are already linked to other orders
  const [linkedCandidates, setLinkedCandidates] = useState<Record<string, string | null>>({});
  const [isCheckingLinks, setIsCheckingLinks] = useState(false);

  // Check link status of match candidates when dialog opens
  useEffect(() => {
    async function checkCandidateLinks() {
      if (!matchCandidates || matchCandidates.length === 0) return;

      setIsCheckingLinks(true);
      try {
        const candidateIds = matchCandidates.map((c) => c.id);
        const response = await fetch('/api/inventory/check-linked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inventoryIds: candidateIds }),
        });

        if (response.ok) {
          const result = await response.json();
          setLinkedCandidates(result.data || {});
        }
      } catch (error) {
        console.error('Failed to check candidate links:', error);
      } finally {
        setIsCheckingLinks(false);
      }
    }

    checkCandidateLinks();
  }, [matchCandidates]);

  // Filter out already-linked candidates and SOLD items for display
  const availableCandidates =
    matchCandidates?.filter((c) => {
      // Exclude if already linked to another order
      if (linkedCandidates[c.id]) return false;
      // Exclude SOLD items (unless they're in search with includeSold)
      if (c.status === 'SOLD') return false;
      return true;
    }) || [];

  const unavailableCandidates =
    matchCandidates?.filter((c) => {
      return linkedCandidates[c.id] || c.status === 'SOLD';
    }) || [];

  return (
    <div className="space-y-4">
      {/* Sale Details */}
      <div className="bg-muted p-4 rounded-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {platform === 'ebay' ? 'eBay' : 'Amazon'} Order
            </p>
            <p className="font-medium font-mono text-sm">{orderId}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Order Date</p>
            <p className="font-medium">{formatDate(orderDate)}</p>
          </div>
        </div>
        <div className="mt-2">
          <p className="text-sm text-muted-foreground">Item</p>
          <p className="font-medium">{title}</p>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-2">
          <div>
            <p className="text-sm text-muted-foreground">{identifierLabel}</p>
            <p className="font-mono text-sm">{identifier || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Quantity</p>
            <p className="font-medium">{quantity}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Sale Amount</p>
            <p className="font-medium">{formatCurrency(totalAmount)}</p>
          </div>
        </div>
      </div>

      {/* Multi-quantity progress */}
      {quantityNeeded > 1 && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Select {quantityNeeded} inventory items</span>
            <span>
              {selectedInventoryIds.length} / {quantityNeeded} selected
            </span>
          </div>
          <Progress value={(selectedInventoryIds.length / quantityNeeded) * 100} />
        </div>
      )}

      {/* Match Candidates */}
      {matchCandidates && matchCandidates.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">Suggested Matches</h4>
            {isCheckingLinks && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking availability...
              </span>
            )}
          </div>

          {/* Warning if some candidates are no longer available */}
          {unavailableCandidates.length > 0 && !isCheckingLinks && (
            <Alert className="mb-2 py-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {unavailableCandidates.length} suggested item
                {unavailableCandidates.length > 1 ? 's are' : ' is'} no longer available (already
                linked to other orders). Use Search below to find available inventory.
              </AlertDescription>
            </Alert>
          )}

          {availableCandidates.length > 0 ? (
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
                  {availableCandidates.map((candidate) => (
                    <TableRow
                      key={candidate.id}
                      className={
                        selectedInventoryIds.includes(candidate.id) ? 'bg-green-50' : undefined
                      }
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {candidate.item_name || candidate.sku || candidate.amazon_asin || '-'}
                          </p>
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
                            selectedInventoryIds.includes(candidate.id) ? 'default' : 'outline'
                          }
                          onClick={() => onSelectCandidate(candidate.id)}
                          disabled={isResolving}
                        >
                          {isResolving ? (
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
          ) : (
            !isCheckingLinks && (
              <p className="text-sm text-muted-foreground py-2">
                No available suggested matches. Use Search below to find inventory.
              </p>
            )
          )}
        </div>
      )}

      {/* Manual Search */}
      <div>
        <h4 className="font-medium mb-2">Search Inventory</h4>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by SKU, ASIN, set number, or name..."
              value={inventorySearch}
              onChange={(e) => setInventorySearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch(inventorySearch);
              }}
              className="pl-10"
            />
          </div>
          <Button onClick={() => onSearch(inventorySearch)} disabled={isSearching}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            id="includeSoldDialog"
            checked={includeSoldItems}
            onChange={(e) => setIncludeSoldItems(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="includeSoldDialog" className="text-sm text-muted-foreground">
            Include already-sold items (for linking legacy data)
          </label>
        </div>

        {searchResults.length > 0 && (
          <div className="border rounded-lg mt-2 max-h-[200px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searchResults.map((item) => {
                  const isLinked = !!item.linked_order_id;
                  const isSold = item.status === 'SOLD';
                  return (
                    <TableRow
                      key={item.id}
                      className={isLinked || isSold ? 'opacity-60 bg-muted/30' : undefined}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {item.item_name || item.sku || item.amazon_asin || '-'}
                          </p>
                          {item.set_number && (
                            <p className="text-xs text-muted-foreground">Set: {item.set_number}</p>
                          )}
                          {isLinked && (
                            <p className="text-xs text-orange-600">
                              Linked to: {item.linked_order_id}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{item.storage_location || '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={
                              item.status === 'SOLD'
                                ? 'secondary'
                                : item.status === 'LISTED'
                                  ? 'default'
                                  : 'outline'
                            }
                            className={
                              item.status === 'SOLD'
                                ? 'bg-gray-500 text-white'
                                : item.status === 'LISTED'
                                  ? 'bg-green-600'
                                  : undefined
                            }
                          >
                            {item.status}
                          </Badge>
                          {item.sold_date && (
                            <span className="text-xs text-muted-foreground">
                              {formatDate(item.sold_date)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isLinked ? (
                          <Badge variant="secondary" className="text-xs">
                            Already Linked
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant={selectedInventoryIds.includes(item.id) ? 'default' : 'outline'}
                            onClick={() => onSelectCandidate(item.id)}
                            disabled={isResolving}
                          >
                            {selectedInventoryIds.includes(item.id) ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              'Select'
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onSkip('skipped')} disabled={isSkipping}>
            <SkipForward className="h-4 w-4 mr-1" />
            Skip
          </Button>
          <Button variant="outline" onClick={() => onSkip('no_inventory')} disabled={isSkipping}>
            No Inventory
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          {quantityNeeded > 1 && (
            <Button
              onClick={onConfirmMultiSelect}
              disabled={selectedInventoryIds.length !== quantityNeeded || isResolving}
            >
              {isResolving ? (
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
  );
}
