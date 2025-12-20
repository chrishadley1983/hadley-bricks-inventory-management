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
  ExternalLink,
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
} from 'lucide-react';
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
import type { PlatformOrder, OrderStatus } from '@hadley-bricks/database';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
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
    bricklink?: PlatformStatus;
    brickowl?: PlatformStatus;
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

async function fetchStatusSummary(): Promise<StatusSummaryResponse> {
  const response = await fetch('/api/orders/status-summary');
  if (!response.ok) throw new Error('Failed to fetch status summary');
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

function formatCurrency(amount: number | null, currency = 'GBP'): string {
  if (amount === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders', page, platform, status, search],
    queryFn: () => fetchOrders(page, platform, status, search),
  });

  const { data: platformStatuses, isLoading: statusLoading } = useQuery({
    queryKey: ['platforms', 'sync-status'],
    queryFn: fetchAllPlatformStatuses,
    refetchInterval: 30000,
  });

  const { data: statusSummary } = useQuery({
    queryKey: ['orders', 'status-summary'],
    queryFn: fetchStatusSummary,
    refetchInterval: 30000,
  });

  const bricklinkStatus = platformStatuses?.data?.bricklink;
  const brickowlStatus = platformStatuses?.data?.brickowl;
  const bricqerStatus = platformStatuses?.data?.bricqer;
  const hasAnyPlatformConfigured =
    bricklinkStatus?.isConfigured ||
    brickowlStatus?.isConfigured ||
    bricqerStatus?.isConfigured;

  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
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

  const orders = ordersData?.data || [];
  const pagination = ordersData?.pagination;

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
          <div className="flex gap-2">
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
                No platforms configured. Connect BrickLink, Brick Owl, or Bricqer to sync
                orders.
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
        <div className="grid gap-4 md:grid-cols-6">
          <Card
            className={`cursor-pointer transition-colors ${status === 'all' ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
            onClick={() => setStatus('all')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">All Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {pagination?.total?.toLocaleString() || '-'}
              </div>
            </CardContent>
          </Card>

          {(['Pending', 'Paid', 'Packed', 'Shipped', 'Completed'] as const).map((s) => (
            <Card
              key={s}
              className={`cursor-pointer transition-colors ${status === s ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
              onClick={() => setStatus(status === s ? 'all' : s)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{s}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {statusSummary?.data?.[s]?.toLocaleString() || '0'}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Platform Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">BrickLink</CardTitle>
              {bricklinkStatus?.isConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {bricklinkStatus?.isConfigured
                  ? bricklinkStatus.totalOrders.toLocaleString()
                  : 'Not configured'}
              </div>
              <p className="text-xs text-muted-foreground">
                {bricklinkStatus?.lastSyncedAt
                  ? `Last sync: ${format(new Date(bricklinkStatus.lastSyncedAt), 'MMM d, h:mm a')}`
                  : bricklinkStatus?.isConfigured
                    ? 'Never synced'
                    : 'Connect in Settings'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Brick Owl</CardTitle>
              {brickowlStatus?.isConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {brickowlStatus?.isConfigured
                  ? brickowlStatus.totalOrders.toLocaleString()
                  : 'Not configured'}
              </div>
              <p className="text-xs text-muted-foreground">
                {brickowlStatus?.lastSyncedAt
                  ? `Last sync: ${format(new Date(brickowlStatus.lastSyncedAt), 'MMM d, h:mm a')}`
                  : brickowlStatus?.isConfigured
                    ? 'Never synced'
                    : 'Connect in Settings'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Bricqer</CardTitle>
              {bricqerStatus?.isConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {bricqerStatus?.isConfigured
                  ? bricqerStatus.totalOrders.toLocaleString()
                  : 'Not configured'}
              </div>
              <p className="text-xs text-muted-foreground">
                {bricqerStatus?.lastSyncedAt
                  ? `Last sync: ${format(new Date(bricqerStatus.lastSyncedAt), 'MMM d, h:mm a')}`
                  : bricqerStatus?.isConfigured
                    ? 'Never synced'
                    : 'Connect in Settings'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Other Platforms</CardTitle>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Coming Soon</div>
              <p className="text-xs text-muted-foreground">eBay, Amazon support planned</p>
            </CardContent>
          </Card>
        </div>

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
                  <SelectItem value="bricklink">BrickLink</SelectItem>
                  <SelectItem value="brickowl">Brick Owl</SelectItem>
                  <SelectItem value="bricqer">Bricqer</SelectItem>
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
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : orders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No orders found. Try syncing with BrickLink.
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
                          <Badge variant="outline" className="capitalize">
                            {order.platform}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {order.order_date
                            ? format(new Date(order.order_date), 'MMM d, yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell>{order.buyer_name || '-'}</TableCell>
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
                                <Link href={`/orders/${order.id}`}>View Details</Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <Link href={`/orders/${order.id}`}>Update Status</Link>
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
