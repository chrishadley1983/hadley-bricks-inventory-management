'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Package,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Search,
  MoreHorizontal,
  ArrowRight,
  Truck,
  PackageCheck,
  XCircle,
  ClipboardList,
  PackageCheck as ConfirmIcon,
  Download,
  Square,
  Calculator,
  ExternalLink,
} from 'lucide-react';
import { ConfirmOrdersDialog } from '@/components/features/orders/ConfirmOrdersDialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import type { PlatformOrder, OrderStatus } from '@hadley-bricks/database';
import { HeaderSkeleton } from '@/components/ui/skeletons';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false, loading: () => <HeaderSkeleton /> }
);

interface OrdersResponse {
  data: PlatformOrder[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface PlatformStatus {
  isConfigured: boolean;
  totalOrders: number;
  lastSyncedAt: string | null;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

interface AllPlatformsStatusResponse {
  data: {
    bricqer?: PlatformStatus;
    ebay?: PlatformStatus;
    amazon?: PlatformStatus;
  };
}

interface SyncResponse {
  success: boolean;
  data: {
    platformResults: Record<
      string,
      {
        success: boolean;
        ordersProcessed: number;
        ordersCreated: number;
        ordersUpdated: number;
        errors: string[];
        lastSyncedAt: string;
      }
    >;
    totalOrdersProcessed: number;
    totalOrdersCreated: number;
    totalOrdersUpdated: number;
    errors: string[];
    syncedAt: string;
  };
}

interface StatusSummaryResponse {
  data: Record<OrderStatus, number>;
  total: number;
  dateRange: string;
}

interface BulkUpdateResponse {
  success: boolean;
  data: {
    updated: number;
    failed: number;
    results: Array<{ orderId: string; success: boolean; error?: string }>;
  };
}

async function fetchOrders(
  page: number,
  platform?: string,
  status?: string,
  search?: string
): Promise<OrdersResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (platform && platform !== 'all') params.set('platform', platform);
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);

  const response = await fetch(`/api/orders?${params}`);
  if (!response.ok) throw new Error('Failed to fetch orders');
  return response.json();
}

async function fetchAllPlatformStatuses(): Promise<AllPlatformsStatusResponse> {
  const response = await fetch('/api/integrations/sync-all-orders');
  if (!response.ok) throw new Error('Failed to fetch sync status');
  return response.json();
}

async function fetchStatusSummary(days?: string, platform?: string): Promise<StatusSummaryResponse> {
  const params = new URLSearchParams();
  if (days && days !== 'all') params.set('days', days);
  if (platform) params.set('platform', platform);
  const url = `/api/orders/status-summary${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch status summary');
  return response.json();
}

interface EbayStatusSummary {
  all: number;
  Paid: number;
  Packed: number;
  Completed: number;
  Refunded: number;
}

async function fetchEbayStatus(): Promise<{ isConnected: boolean }> {
  const response = await fetch('/api/integrations/ebay/status');
  if (!response.ok) return { isConnected: false };
  return response.json();
}

async function fetchEbayStatusSummary(days?: string): Promise<{ data: EbayStatusSummary }> {
  const params = new URLSearchParams();
  if (days && days !== 'all') params.set('days', days);
  const url = `/api/orders/ebay/status-summary${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch eBay status summary');
  return response.json();
}

async function fetchEbaySyncLog(): Promise<{ logs: Array<{ started_at: string; status: string }> }> {
  const response = await fetch('/api/integrations/ebay/sync');
  if (!response.ok) return { logs: [] };
  return response.json();
}

// eBay orders for the table
interface EbayLineItem {
  id: string;
  ebay_line_item_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  legacy_item_id?: string;
  inventory_item_id?: string | null;
}

interface EbayOrder {
  id: string;
  ebay_order_id: string;
  buyer_username: string;
  creation_date: string;
  total: number;
  currency: string;
  order_fulfilment_status: string;
  order_payment_status: string;
  ui_status: string;
  line_items?: EbayLineItem[];
}

interface EbayOrdersResponse {
  data: EbayOrder[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

async function fetchEbayOrders(
  page: number,
  status?: string,
  search?: string
): Promise<EbayOrdersResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);

  const response = await fetch(`/api/orders/ebay?${params}`);
  if (!response.ok) throw new Error('Failed to fetch eBay orders');
  return response.json();
}

// Transform eBay order to PlatformOrder-like format for display
function transformEbayOrderForDisplay(ebayOrder: EbayOrder): PlatformOrder & { order_items?: Array<{ id: string; item_name: string | null; item_number: string | null; inventory_item_id: string | null; legacy_item_id?: string }> } {
  // Transform line_items to order_items format for consistent display
  const orderItems = (ebayOrder.line_items || []).map((li) => ({
    id: li.id,
    item_name: li.title,
    item_number: li.sku,
    inventory_item_id: li.inventory_item_id || null,
    legacy_item_id: li.legacy_item_id,
  }));

  return {
    id: ebayOrder.id,
    platform: 'ebay',
    platform_order_id: ebayOrder.ebay_order_id,
    order_date: ebayOrder.creation_date,
    buyer_name: ebayOrder.buyer_username,
    buyer_email: null,
    total: ebayOrder.total,
    subtotal: null,
    shipping: null,
    tax: null,
    fees: null,
    currency: ebayOrder.currency,
    status: ebayOrder.ui_status,
    internal_status: ebayOrder.ui_status as OrderStatus,
    shipping_address: null,
    created_at: ebayOrder.creation_date,
    updated_at: ebayOrder.creation_date,
    synced_at: null,
    user_id: '',
    items: [],
    order_items: orderItems,
    // Additional fields expected by PlatformOrder
    cancelled_at: null,
    completed_at: null,
    items_count: null,
    notes: null,
    packed_at: null,
    payment_method: null,
    shipped_at: null,
  } as unknown as PlatformOrder & { order_items?: Array<{ id: string; item_name: string | null; item_number: string | null; inventory_item_id: string | null; legacy_item_id?: string }> };
}

// Backfill types and functions
interface BackfillProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  isRunning: boolean;
  startedAt: string | null;
  estimatedSecondsRemaining: number | null;
  currentOrderId: string | null;
  errors: string[];
}

interface BackfillStatusResponse {
  data: {
    progress: BackfillProgress;
    ordersNeedingBackfill: number;
  };
}

async function fetchBackfillStatus(): Promise<BackfillStatusResponse> {
  const response = await fetch('/api/orders/backfill');
  if (!response.ok) throw new Error('Failed to fetch backfill status');
  return response.json();
}

async function startBackfill(batchSize?: number): Promise<{ data: { progress: BackfillProgress } }> {
  const response = await fetch('/api/orders/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchSize: batchSize || 50 }),
  });
  if (!response.ok) throw new Error('Failed to start backfill');
  return response.json();
}

async function stopBackfill(): Promise<void> {
  await fetch('/api/orders/backfill', { method: 'DELETE' });
}

// Fee reconciliation types and functions
interface FeeReconciliationPreview {
  totalItemsNeedingReconciliation: number;
}

interface FeeReconciliationResult {
  success: boolean;
  itemsProcessed: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errors: string[];
}

async function fetchFeeReconciliationPreview(): Promise<{ data: FeeReconciliationPreview }> {
  const response = await fetch('/api/admin/reconcile-amazon-fees');
  if (!response.ok) throw new Error('Failed to fetch fee reconciliation preview');
  return response.json();
}

async function runFeeReconciliation(): Promise<{ data: FeeReconciliationResult }> {
  const response = await fetch('/api/admin/reconcile-amazon-fees', { method: 'POST' });
  if (!response.ok) throw new Error('Failed to run fee reconciliation');
  return response.json();
}

async function triggerSync(): Promise<SyncResponse> {
  const response = await fetch('/api/integrations/sync-all-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeItems: true }),
  });
  if (!response.ok) throw new Error('Failed to sync');
  return response.json();
}

async function triggerPlatformSync(platform: string): Promise<SyncResponse> {
  const response = await fetch('/api/integrations/sync-all-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platforms: [platform], includeItems: true }),
  });
  if (!response.ok) throw new Error(`Failed to sync ${platform}`);
  return response.json();
}

async function triggerEbaySync(): Promise<{ success: boolean }> {
  const response = await fetch('/api/integrations/ebay/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('Failed to sync eBay');
  return response.json();
}

async function bulkUpdateStatus(
  orderIds: string[],
  status: OrderStatus
): Promise<BulkUpdateResponse> {
  const response = await fetch('/api/orders/bulk-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderIds, status }),
  });
  if (!response.ok) throw new Error('Failed to update status');
  return response.json();
}

function getStatusColor(status: string | null): string {
  const statusLower = (status || '').toLowerCase();
  if (statusLower.includes('completed') || statusLower.includes('received')) {
    return 'bg-green-100 text-green-800';
  }
  if (statusLower.includes('shipped') || statusLower.includes('packed')) {
    return 'bg-blue-100 text-blue-800';
  }
  if (statusLower.includes('paid') || statusLower.includes('ready')) {
    return 'bg-purple-100 text-purple-800';
  }
  if (statusLower.includes('pending') || statusLower.includes('processing')) {
    return 'bg-yellow-100 text-yellow-800';
  }
  if (statusLower.includes('cancel') || statusLower.includes('npb')) {
    return 'bg-red-100 text-red-800';
  }
  return 'bg-gray-100 text-gray-800';
}

function formatCurrency(amount: number | null, currency?: string | null): string {
  if (amount === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(amount);
}

type TimeframeOption = 'all' | '7' | '30' | '90';

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmDialogPlatform, setConfirmDialogPlatform] = useState<'amazon' | 'ebay'>('amazon');
  const [timeframe, setTimeframe] = useState<TimeframeOption>('all');

  // Use different query based on platform selection
  const isEbayPlatform = platform === 'ebay';
  const isAllPlatforms = platform === 'all';

  // Regular orders query (when not filtering to eBay only)
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders', page, platform, status, search],
    queryFn: () => fetchOrders(page, platform, status, search),
    enabled: !isEbayPlatform,
  });

  // eBay orders query (when eBay platform selected OR when showing all platforms)
  const { data: ebayOrdersData, isLoading: ebayOrdersLoading } = useQuery({
    queryKey: ['ebay', 'orders', 'list', page, status, search],
    queryFn: () => fetchEbayOrders(page, status, search),
    enabled: isEbayPlatform || isAllPlatforms,
  });

  const { data: platformStatuses, isLoading: statusLoading } = useQuery({
    queryKey: ['platforms', 'sync-status'],
    queryFn: fetchAllPlatformStatuses,
    refetchInterval: 30000,
  });

  const { data: statusSummary } = useQuery({
    queryKey: ['orders', 'status-summary', timeframe],
    queryFn: () => fetchStatusSummary(timeframe),
    refetchInterval: 30000,
  });

  // eBay specific queries
  const { data: ebayConnectionStatus } = useQuery({
    queryKey: ['ebay', 'status'],
    queryFn: fetchEbayStatus,
    refetchInterval: 60000,
  });

  const { data: ebayStatusSummary } = useQuery({
    queryKey: ['ebay', 'orders', 'status-summary', timeframe],
    queryFn: () => fetchEbayStatusSummary(timeframe),
    enabled: ebayConnectionStatus?.isConnected,
    refetchInterval: 30000,
  });

  const { data: ebaySyncLog } = useQuery({
    queryKey: ['ebay', 'sync-log'],
    queryFn: fetchEbaySyncLog,
    enabled: ebayConnectionStatus?.isConnected,
    refetchInterval: 60000,
  });

  const bricqerStatus = platformStatuses?.data?.bricqer;
  const amazonStatus = platformStatuses?.data?.amazon;

  // Platform-specific status summaries (must be after bricqerStatus/amazonStatus are defined)
  const { data: bricqerStatusSummary } = useQuery({
    queryKey: ['orders', 'status-summary', 'bricqer', timeframe],
    queryFn: () => fetchStatusSummary(timeframe, 'bricqer'),
    enabled: bricqerStatus?.isConfigured,
    refetchInterval: 30000,
  });

  const { data: amazonStatusSummary } = useQuery({
    queryKey: ['orders', 'status-summary', 'amazon', timeframe],
    queryFn: () => fetchStatusSummary(timeframe, 'amazon'),
    enabled: amazonStatus?.isConfigured,
    refetchInterval: 30000,
  });

  // Amazon backfill query - poll while running
  const { data: backfillStatus } = useQuery({
    queryKey: ['amazon', 'backfill'],
    queryFn: fetchBackfillStatus,
    enabled: amazonStatus?.isConfigured || false,
    refetchInterval: (query) => {
      // Poll every 2 seconds while running, otherwise every 30 seconds
      return query.state.data?.data?.progress?.isRunning ? 2000 : 30000;
    },
  });

  const backfillMutation = useMutation({
    mutationFn: startBackfill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amazon', 'backfill'] });
    },
  });

  const stopBackfillMutation = useMutation({
    mutationFn: stopBackfill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amazon', 'backfill'] });
    },
  });

  // Fee reconciliation query and mutation
  const { data: feeReconciliationPreview } = useQuery({
    queryKey: ['amazon', 'fee-reconciliation'],
    queryFn: fetchFeeReconciliationPreview,
    enabled: amazonStatus?.isConfigured || false,
    refetchInterval: 60000, // Refresh every minute
  });

  const feeReconciliationMutation = useMutation({
    mutationFn: runFeeReconciliation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amazon', 'fee-reconciliation'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const itemsNeedingFeeReconciliation = feeReconciliationPreview?.data?.totalItemsNeedingReconciliation || 0;

  const ebayConnected = ebayConnectionStatus?.isConnected || false;
  const ebayLastSync = ebaySyncLog?.logs?.[0]?.started_at;
  const ebayUnfulfilledCount = (ebayStatusSummary?.data?.Paid || 0) + (ebayStatusSummary?.data?.Packed || 0);

  // Backfill state
  const backfillProgress = backfillStatus?.data?.progress;
  const ordersNeedingBackfill = backfillStatus?.data?.ordersNeedingBackfill || 0;
  const isBackfillRunning = backfillProgress?.isRunning || false;

  // Compute combined status summary (regular orders + eBay orders)
  // Note: eBay orders are stored in a separate table so we need to add them
  const combinedStatusSummary = {
    Pending: (statusSummary?.data?.Pending || 0),
    Paid: (statusSummary?.data?.Paid || 0) + (ebayStatusSummary?.data?.Paid || 0),
    Packed: (statusSummary?.data?.Packed || 0) + (ebayStatusSummary?.data?.Packed || 0),
    Shipped: (statusSummary?.data?.Shipped || 0),
    Completed: (statusSummary?.data?.Completed || 0) + (ebayStatusSummary?.data?.Completed || 0),
    Cancelled: (statusSummary?.data?.Cancelled || 0) + (ebayStatusSummary?.data?.Refunded || 0),
  };

  // Total order count from status summary (this is the accurate total from DB)
  // Use the total from status summary API which sums all statuses correctly
  const platformOrdersTotal = statusSummary?.total || 0;
  const ebayOrdersTotal = ebayStatusSummary?.data?.all || 0;
  const totalOrderCount = platformOrdersTotal + ebayOrdersTotal;

  const hasAnyPlatformConfigured =
    bricqerStatus?.isConfigured ||
    amazonStatus?.isConfigured ||
    ebayConnected;

  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['platforms', 'sync-status'] });
    },
  });

  const bricqerSyncMutation = useMutation({
    mutationFn: () => triggerPlatformSync('bricqer'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['platforms', 'sync-status'] });
    },
  });

  const amazonSyncMutation = useMutation({
    mutationFn: () => triggerPlatformSync('amazon'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['platforms', 'sync-status'] });
    },
  });

  const ebaySyncMutation = useMutation({
    mutationFn: triggerEbaySync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay'] });
      queryClient.invalidateQueries({ queryKey: ['platforms', 'sync-status'] });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ orderIds, newStatus }: { orderIds: string[]; newStatus: OrderStatus }) =>
      bulkUpdateStatus(orderIds, newStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setSelectedOrders(new Set());
    },
  });

  // Compute orders and pagination based on platform selection
  let orders: PlatformOrder[];
  let pagination: OrdersResponse['pagination'] | undefined;
  let isLoading: boolean;

  if (isEbayPlatform) {
    // eBay only
    orders = (ebayOrdersData?.data || []).map(transformEbayOrderForDisplay);
    pagination = ebayOrdersData?.pagination;
    isLoading = ebayOrdersLoading;
  } else if (isAllPlatforms) {
    // Merge regular orders with eBay orders
    const regularOrders = ordersData?.data || [];
    const ebayOrders = (ebayOrdersData?.data || []).map(transformEbayOrderForDisplay);

    // Combine and sort by date (most recent first)
    orders = [...regularOrders, ...ebayOrders].sort((a, b) => {
      const dateA = a.order_date ? new Date(a.order_date).getTime() : 0;
      const dateB = b.order_date ? new Date(b.order_date).getTime() : 0;
      return dateB - dateA;
    });

    // For "all platforms", we show a combined view - pagination is approximate
    const regularTotal = ordersData?.pagination?.total || 0;
    const ebayTotal = ebayOrdersData?.pagination?.total || 0;
    pagination = {
      page: 1,
      pageSize: orders.length,
      total: regularTotal + ebayTotal,
      totalPages: 1,
    };
    isLoading = ordersLoading || ebayOrdersLoading;
  } else {
    // Specific platform (not eBay)
    orders = ordersData?.data || [];
    pagination = ordersData?.pagination;
    isLoading = ordersLoading;
  }

  const toggleOrderSelection = (orderId: string) => {
    const newSelection = new Set(selectedOrders);
    if (newSelection.has(orderId)) {
      newSelection.delete(orderId);
    } else {
      newSelection.add(orderId);
    }
    setSelectedOrders(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === orders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(orders.map((o) => o.id)));
    }
  };

  const handleBulkStatusUpdate = (newStatus: OrderStatus) => {
    bulkStatusMutation.mutate({
      orderIds: Array.from(selectedOrders),
      newStatus,
    });
  };

  const getEffectiveStatus = (order: PlatformOrder): string => {
    return order.internal_status || order.status || 'Pending';
  };

  return (
    <>
      <Header title="Orders" />
      <div className="p-6 space-y-6">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Orders</h2>
            <p className="text-muted-foreground">
              View and manage orders from your connected platforms
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Timeframe Selector */}
            <Select value={timeframe} onValueChange={(v: string) => setTimeframe(v as TimeframeOption)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Timeframe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="90">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !hasAnyPlatformConfigured}
            >
              {syncMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync All Platforms
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Sync Status Alert */}
        {!statusLoading && !hasAnyPlatformConfigured && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>
                No platforms configured. Connect Bricqer, Amazon, or eBay to sync orders.
              </span>
              <Link href="/settings/integrations">
                <Button variant="outline" size="sm">
                  <Settings className="mr-2 h-4 w-4" />
                  Configure
                </Button>
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {/* Sync Result */}
        {syncMutation.isSuccess && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Sync complete: {syncMutation.data.data.totalOrdersProcessed} orders processed
              ({syncMutation.data.data.totalOrdersCreated} new,{' '}
              {syncMutation.data.data.totalOrdersUpdated} updated)
              {syncMutation.data.data.errors.length > 0 && (
                <span className="text-red-600">
                  {' '}
                  with {syncMutation.data.data.errors.length} errors
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Status Summary Cards */}
        <div className="grid gap-4 md:grid-cols-7">
          <Card
            className={`cursor-pointer transition-colors ${status === 'all' ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
            onClick={() => setStatus('all')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">All Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalOrderCount.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          {(['Pending', 'Paid', 'Packed', 'Shipped', 'Completed', 'Cancelled'] as const).map((s) => (
            <Card
              key={s}
              className={`cursor-pointer transition-colors ${status === s ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
              onClick={() => setStatus(status === s ? 'all' : s)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{s === 'Cancelled' ? 'Cancelled/Refunded' : s}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {combinedStatusSummary[s]?.toLocaleString() || '0'}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Platform Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Bricqer Card */}
          <Card className={`${platform === 'bricqer' ? 'ring-2 ring-primary' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle
                className="text-sm font-medium cursor-pointer hover:text-primary"
                onClick={() => setPlatform(platform === 'bricqer' ? 'all' : 'bricqer')}
              >
                Bricqer
              </CardTitle>
              {bricqerStatus?.isConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {bricqerStatus?.isConfigured ? (
                <>
                  <div className="space-y-1">
                    <div
                      className="text-2xl font-bold cursor-pointer hover:text-primary"
                      onClick={() => {
                        setPlatform('bricqer');
                        setStatus('all');
                      }}
                    >
                      {(bricqerStatusSummary?.total || 0).toLocaleString()} orders
                    </div>
                    <div className="flex gap-2 text-xs flex-wrap">
                      <span
                        className="text-yellow-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('bricqer');
                          setStatus('Pending');
                        }}
                      >
                        {bricqerStatusSummary?.data?.Pending || 0} Pending
                      </span>
                      <span
                        className="text-purple-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('bricqer');
                          setStatus('Paid');
                        }}
                      >
                        {bricqerStatusSummary?.data?.Paid || 0} Paid
                      </span>
                      <span
                        className="text-blue-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('bricqer');
                          setStatus('Shipped');
                        }}
                      >
                        {bricqerStatusSummary?.data?.Shipped || 0} Shipped
                      </span>
                      <span
                        className="text-green-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('bricqer');
                          setStatus('Completed');
                        }}
                      >
                        {bricqerStatusSummary?.data?.Completed || 0} Done
                      </span>
                      <span
                        className="text-red-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('bricqer');
                          setStatus('Cancelled');
                        }}
                      >
                        {bricqerStatusSummary?.data?.Cancelled || 0} Cancelled
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {bricqerStatus.lastSyncedAt
                      ? `Last sync: ${format(new Date(bricqerStatus.lastSyncedAt), 'MMM d, h:mm a')}`
                      : 'Never synced'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      bricqerSyncMutation.mutate();
                    }}
                    disabled={bricqerSyncMutation.isPending}
                  >
                    {bricqerSyncMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Sync Bricqer
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-lg font-medium text-muted-foreground">Not configured</div>
                  <Link href="/settings/integrations">
                    <Button variant="outline" size="sm" className="w-full">
                      <Settings className="mr-2 h-4 w-4" />
                      Configure
                    </Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>

          {/* Amazon Card */}
          <Card className={`${platform === 'amazon' ? 'ring-2 ring-primary' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Link href="/orders/amazon">
                <CardTitle className="text-sm font-medium cursor-pointer hover:text-primary">
                  Amazon
                </CardTitle>
              </Link>
              {amazonStatus?.isConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {amazonStatus?.isConfigured ? (
                <>
                  <div className="space-y-1">
                    <div
                      className="text-2xl font-bold cursor-pointer hover:text-primary"
                      onClick={() => {
                        setPlatform('amazon');
                        setStatus('all');
                      }}
                    >
                      {(amazonStatusSummary?.total || 0).toLocaleString()} orders
                    </div>
                    <div className="flex gap-2 text-xs flex-wrap">
                      <span
                        className="text-yellow-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('amazon');
                          setStatus('Pending');
                        }}
                      >
                        {amazonStatusSummary?.data?.Pending || 0} Pending
                      </span>
                      <span
                        className="text-purple-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('amazon');
                          setStatus('Paid');
                        }}
                      >
                        {amazonStatusSummary?.data?.Paid || 0} Paid
                      </span>
                      <span
                        className="text-blue-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('amazon');
                          setStatus('Shipped');
                        }}
                      >
                        {amazonStatusSummary?.data?.Shipped || 0} Shipped
                      </span>
                      <span
                        className="text-green-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('amazon');
                          setStatus('Completed');
                        }}
                      >
                        {amazonStatusSummary?.data?.Completed || 0} Done
                      </span>
                      <span
                        className="text-red-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('amazon');
                          setStatus('Cancelled');
                        }}
                      >
                        {amazonStatusSummary?.data?.Cancelled || 0} Cancelled
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {amazonStatus.lastSyncedAt
                      ? `Last sync: ${format(new Date(amazonStatus.lastSyncedAt), 'MMM d, h:mm a')}`
                      : 'Never synced'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        amazonSyncMutation.mutate();
                      }}
                      disabled={amazonSyncMutation.isPending}
                    >
                      {amazonSyncMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <RefreshCw className="mr-1 h-4 w-4" />
                          Sync
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open('/api/picking-list/amazon?format=pdf', '_blank');
                      }}
                    >
                      <ClipboardList className="mr-1 h-4 w-4" />
                      Pick List
                    </Button>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDialogPlatform('amazon');
                      setConfirmDialogOpen(true);
                    }}
                  >
                    <ConfirmIcon className="mr-2 h-4 w-4" />
                    Confirm Orders Processed
                  </Button>

                  {/* Fee Reconciliation Section */}
                  {itemsNeedingFeeReconciliation > 0 && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                        <span>{itemsNeedingFeeReconciliation} items missing fee data</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          feeReconciliationMutation.mutate();
                        }}
                        disabled={feeReconciliationMutation.isPending}
                      >
                        {feeReconciliationMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Calculator className="mr-2 h-4 w-4" />
                        )}
                        {feeReconciliationMutation.isPending ? 'Reconciling...' : 'Reconcile Fees'}
                      </Button>
                      {feeReconciliationMutation.isSuccess && (
                        <p className="text-xs text-green-600 mt-1">
                          Updated {feeReconciliationMutation.data.data.itemsUpdated} items
                        </p>
                      )}
                    </div>
                  )}

                  {/* Backfill Section */}
                  {ordersNeedingBackfill > 0 && !isBackfillRunning && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                        <span>{ordersNeedingBackfill} orders missing item details</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          backfillMutation.mutate(50);
                        }}
                        disabled={backfillMutation.isPending}
                      >
                        {backfillMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        Fetch Missing Items
                      </Button>
                    </div>
                  )}

                  {/* Backfill Progress */}
                  {isBackfillRunning && backfillProgress && (
                    <div className="pt-2 border-t space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Fetching items: {backfillProgress.processed}/{backfillProgress.total}
                        </span>
                        {backfillProgress.estimatedSecondsRemaining !== null && (
                          <span className="text-muted-foreground">
                            ~{Math.ceil(backfillProgress.estimatedSecondsRemaining / 60)}m remaining
                          </span>
                        )}
                      </div>
                      <Progress
                        value={(backfillProgress.processed / backfillProgress.total) * 100}
                        className="h-2"
                      />
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-green-600">{backfillProgress.success} success</span>
                        {backfillProgress.failed > 0 && (
                          <span className="text-red-600">{backfillProgress.failed} failed</span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          stopBackfillMutation.mutate();
                        }}
                        disabled={stopBackfillMutation.isPending}
                      >
                        <Square className="mr-2 h-4 w-4" />
                        Stop Backfill
                      </Button>
                    </div>
                  )}

                  {/* Backfill Complete Message */}
                  {!isBackfillRunning && backfillProgress && backfillProgress.processed > 0 && ordersNeedingBackfill === 0 && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center gap-2 text-xs text-green-600">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>All order items fetched</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-lg font-medium text-muted-foreground">Not configured</div>
                  <Link href="/settings/integrations">
                    <Button variant="outline" size="sm" className="w-full">
                      <Settings className="mr-2 h-4 w-4" />
                      Configure
                    </Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>

          {/* eBay Card */}
          <Card className={`${platform === 'ebay' ? 'ring-2 ring-primary' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Link href="/orders/ebay">
                <CardTitle className="text-sm font-medium cursor-pointer hover:text-primary">
                  eBay
                </CardTitle>
              </Link>
              {ebayConnected ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {ebayConnected ? (
                <>
                  <div className="space-y-1">
                    <div
                      className="text-2xl font-bold cursor-pointer hover:text-primary"
                      onClick={() => {
                        setPlatform('ebay');
                        setStatus('all');
                      }}
                    >
                      {(ebayStatusSummary?.data?.all || 0).toLocaleString()} orders
                    </div>
                    <div className="flex gap-2 text-xs flex-wrap">
                      <span
                        className="text-purple-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('ebay');
                          setStatus('Paid');
                        }}
                      >
                        {ebayStatusSummary?.data?.Paid || 0} Paid
                      </span>
                      <span
                        className="text-blue-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('ebay');
                          setStatus('Packed');
                        }}
                      >
                        {ebayStatusSummary?.data?.Packed || 0} Packed
                      </span>
                      <span
                        className="text-green-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('ebay');
                          setStatus('Completed');
                        }}
                      >
                        {ebayStatusSummary?.data?.Completed || 0} Done
                      </span>
                      <span
                        className="text-red-600 cursor-pointer hover:underline"
                        onClick={() => {
                          setPlatform('ebay');
                          setStatus('Cancelled');
                        }}
                      >
                        {ebayStatusSummary?.data?.Refunded || 0} Refunded
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ebayLastSync
                      ? `Last sync: ${format(new Date(ebayLastSync), 'MMM d, h:mm a')}`
                      : 'Never synced'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        ebaySyncMutation.mutate();
                      }}
                      disabled={ebaySyncMutation.isPending}
                    >
                      {ebaySyncMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <RefreshCw className="mr-1 h-4 w-4" />
                          Sync
                        </>
                      )}
                    </Button>
                    {ebayUnfulfilledCount > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open('/api/picking-list/ebay?format=pdf', '_blank');
                        }}
                      >
                        <ClipboardList className="mr-1 h-4 w-4" />
                        Pick List
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDialogPlatform('ebay');
                      setConfirmDialogOpen(true);
                    }}
                  >
                    <ConfirmIcon className="mr-2 h-4 w-4" />
                    Confirm Orders Processed
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-lg font-medium text-muted-foreground">Not connected</div>
                  <Link href="/settings/integrations">
                    <Button variant="outline" size="sm" className="w-full">
                      <Settings className="mr-2 h-4 w-4" />
                      Connect
                    </Button>
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Confirm Orders Dialog */}
        <ConfirmOrdersDialog
          open={confirmDialogOpen}
          onOpenChange={setConfirmDialogOpen}
          platform={confirmDialogPlatform}
        />

        {/* Orders Table Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Order History</CardTitle>
                <CardDescription>
                  Browse and filter your orders from all platforms
                </CardDescription>
              </div>

              {/* Bulk Actions */}
              {selectedOrders.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedOrders.size} selected
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Update Status
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => handleBulkStatusUpdate('Paid')}>
                        <PackageCheck className="mr-2 h-4 w-4" />
                        Mark as Paid
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusUpdate('Packed')}>
                        <Package className="mr-2 h-4 w-4" />
                        Mark as Packed
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusUpdate('Shipped')}>
                        <Truck className="mr-2 h-4 w-4" />
                        Mark as Shipped
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusUpdate('Completed')}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Mark as Completed
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleBulkStatusUpdate('Cancelled')}
                        className="text-red-600"
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Cancel Orders
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex gap-4 mb-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search orders..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  <SelectItem value="bricqer">Bricqer</SelectItem>
                  <SelectItem value="amazon">Amazon</SelectItem>
                  <SelectItem value="ebay">eBay</SelectItem>
                </SelectContent>
              </Select>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                  <SelectItem value="Packed">Packed</SelectItem>
                  <SelectItem value="Shipped">Shipped</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Orders Table */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={
                          orders.length > 0 && selectedOrders.size === orders.length
                        }
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : orders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-center py-8 text-muted-foreground"
                      >
                        {isEbayPlatform
                          ? 'No eBay orders found. Try syncing with eBay.'
                          : 'No orders found. Try syncing with the selected platform.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    orders.map((order) => (
                      <TableRow
                        key={order.id}
                        className={selectedOrders.has(order.id) ? 'bg-muted/50' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedOrders.has(order.id)}
                            onCheckedChange={() => toggleOrderSelection(order.id)}
                            aria-label={`Select order ${order.platform_order_id}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {order.platform_order_id}
                        </TableCell>
                        <TableCell>
                          {order.platform === 'ebay' ? (
                            <Link href="/orders/ebay">
                              <Badge variant="outline" className="capitalize cursor-pointer hover:bg-muted">
                                {order.platform}
                              </Badge>
                            </Link>
                          ) : order.platform === 'amazon' ? (
                            <Link href="/orders/amazon">
                              <Badge variant="outline" className="capitalize cursor-pointer hover:bg-muted">
                                {order.platform}
                              </Badge>
                            </Link>
                          ) : (
                            <Badge
                              variant="outline"
                              className="capitalize cursor-pointer hover:bg-muted"
                              onClick={() => setPlatform(order.platform)}
                            >
                              {order.platform}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {order.order_date
                            ? format(new Date(order.order_date), 'MMM d, yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell>{order.buyer_name || '-'}</TableCell>
                        <TableCell className="max-w-[300px]">
                          {(() => {
                            const orderWithItems = order as PlatformOrder & { order_items?: Array<{ id: string; item_name?: string | null; item_number?: string | null; inventory_item_id?: string | null; legacy_item_id?: string }> };
                            const items = orderWithItems.order_items || [];
                            const itemNames = items.map((item) => item.item_name).filter(Boolean).join(', ');
                            const linkedItem = items.find((item) => item.inventory_item_id);
                            const firstItem = items[0];
                            // For eBay orders, get legacy_item_id for external link
                            const ebayItemId = order.platform === 'ebay' && firstItem?.legacy_item_id;
                            // For Amazon orders, item_number contains the ASIN
                            const amazonAsin = order.platform === 'amazon' && firstItem?.item_number;

                            return (
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm" title={itemNames || order.notes || '-'}>
                                  {itemNames || order.notes || '-'}
                                </span>
                                {ebayItemId && (
                                  <a
                                    href={`https://www.ebay.co.uk/itm/${ebayItemId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="View on eBay"
                                    className="flex-shrink-0"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                  </a>
                                )}
                                {amazonAsin && (
                                  <a
                                    href={`https://www.amazon.co.uk/dp/${amazonAsin}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="View on Amazon"
                                    className="flex-shrink-0"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                  </a>
                                )}
                                {linkedItem?.inventory_item_id && (
                                  <a
                                    href={`/inventory/${linkedItem.inventory_item_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="View linked inventory item"
                                    className="flex-shrink-0"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5 text-green-600 hover:text-green-700" />
                                  </a>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(getEffectiveStatus(order))}>
                            {getEffectiveStatus(order)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(order.total, order.currency)}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={order.platform === 'ebay' ? `/orders/ebay/${order.id}` : `/orders/${order.id}`}>
                                  View Details
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <Link href={order.platform === 'ebay' ? `/orders/ebay/${order.id}` : `/orders/${order.id}`}>
                                  Update Status
                                </Link>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(pagination.page - 1) * pagination.pageSize + 1} to{' '}
                  {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
                  {pagination.total} orders
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= pagination.totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
