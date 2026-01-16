'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Search,
  MoreHorizontal,
  ExternalLink,
  ClipboardList,
  Download,
  CheckSquare,
  AlertCircle,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EbaySkuMatcherDialog } from '@/components/features/orders/EbaySkuMatcherDialog';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface EbayOrder {
  id: string;
  ebay_order_id: string;
  creation_date: string;
  buyer_username: string;
  order_fulfilment_status: string;
  order_payment_status: string;
  ui_status: 'Paid' | 'Packed' | 'Completed' | 'Refunded';
  total: number;
  currency: string;
  line_items: Array<{
    id: string;
    sku: string | null;
    title: string;
    quantity: number;
    total_amount: number;
    fulfilment_status: string;
    match_status?: 'matched' | 'manual' | 'unmatched' | 'no_sku';
  }>;
  match_summary?: {
    total: number;
    unmatched: number;
    no_sku?: number;
    all_matched: boolean;
  };
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

interface EbayStatusSummary {
  all: number;
  Paid: number;
  Packed: number;
  Completed: number;
  Refunded: number;
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

async function fetchEbayStatusSummary(): Promise<{ data: EbayStatusSummary }> {
  const response = await fetch('/api/orders/ebay/status-summary');
  if (!response.ok) throw new Error('Failed to fetch status summary');
  return response.json();
}

async function syncEbayOrders(): Promise<{ success: boolean; results: { orders: { ordersProcessed: number } } }> {
  const response = await fetch('/api/integrations/ebay/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'orders' }),
  });
  if (!response.ok) throw new Error('Failed to sync eBay orders');
  return response.json();
}

async function confirmOrder(orderId: string, skipUnmatched: boolean = false): Promise<{ success: boolean; data?: { unmatchedItems: number }; error?: string; unmatchedItems?: string[] }> {
  const response = await fetch(`/api/orders/ebay/${orderId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipUnmatched }),
  });
  return response.json();
}

async function confirmBulkOrders(orderIds: string[], skipUnmatched: boolean = false): Promise<{ success: boolean; data: { confirmed: number; failed: number } }> {
  const response = await fetch('/api/orders/ebay/confirm-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderIds, skipUnmatched }),
  });
  if (!response.ok) throw new Error('Failed to confirm orders');
  return response.json();
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'Completed':
      return 'bg-green-100 text-green-800';
    case 'Packed':
      return 'bg-blue-100 text-blue-800';
    case 'Paid':
      return 'bg-purple-100 text-purple-800';
    case 'Refunded':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatCurrency(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

export default function EbayOrdersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('ebay');
  const [status, setStatus] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingConfirmOrderId, setPendingConfirmOrderId] = useState<string | null>(null);
  const [unmatchedWarning, setUnmatchedWarning] = useState<string[] | null>(null);
  const [skuMatcherOpen, setSkuMatcherOpen] = useState(false);
  const [selectedItemForMatching, setSelectedItemForMatching] = useState<{ sku: string; title: string } | null>(null);
  const [unmatchedItemsDialogOpen, setUnmatchedItemsDialogOpen] = useState(false);
  const [selectedOrderUnmatchedItems, setSelectedOrderUnmatchedItems] = useState<Array<{ sku: string; title: string }>>([]);

  // Handle platform change - redirect to main orders page for other platforms
  const handlePlatformChange = (newPlatform: string) => {
    if (newPlatform !== 'ebay') {
      router.push(`/orders?platform=${newPlatform}`);
    } else {
      setPlatform(newPlatform);
    }
  };

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['ebay', 'orders', page, status, search],
    queryFn: () => fetchEbayOrders(page, status, search),
  });

  const { data: statusSummary } = useQuery({
    queryKey: ['ebay', 'orders', 'status-summary'],
    queryFn: fetchEbayStatusSummary,
    refetchInterval: 30000,
  });

  const syncMutation = useMutation({
    mutationFn: syncEbayOrders,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay', 'orders'] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: ({ orderId, skipUnmatched }: { orderId: string; skipUnmatched: boolean }) =>
      confirmOrder(orderId, skipUnmatched),
    onSuccess: (data, variables) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['ebay', 'orders'] });
        setConfirmDialogOpen(false);
        setPendingConfirmOrderId(null);
        setUnmatchedWarning(null);
      } else if (data.unmatchedItems && data.unmatchedItems.length > 0) {
        setPendingConfirmOrderId(variables.orderId);
        setUnmatchedWarning(data.unmatchedItems);
        setConfirmDialogOpen(true);
      }
    },
  });

  const bulkConfirmMutation = useMutation({
    mutationFn: ({ orderIds, skipUnmatched }: { orderIds: string[]; skipUnmatched: boolean }) =>
      confirmBulkOrders(orderIds, skipUnmatched),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay', 'orders'] });
      setSelectedOrders(new Set());
    },
  });

  const allOrders = ordersData?.data || [];
  const pagination = ordersData?.pagination;

  // Filter orders by match status (client-side)
  const orders = allOrders.filter((order) => {
    if (matchFilter === 'all') return true;
    if (matchFilter === 'unmatched') {
      return (order.match_summary?.unmatched || 0) > 0;
    }
    if (matchFilter === 'no_sku') {
      return (order.match_summary?.no_sku || 0) > 0;
    }
    if (matchFilter === 'matched') {
      return order.match_summary?.all_matched === true;
    }
    return true;
  });

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

  const handleConfirmOrder = (orderId: string) => {
    confirmMutation.mutate({ orderId, skipUnmatched: false });
  };

  const handleConfirmWithSkip = () => {
    if (pendingConfirmOrderId) {
      confirmMutation.mutate({ orderId: pendingConfirmOrderId, skipUnmatched: true });
    }
  };

  const handleBulkConfirm = (skipUnmatched: boolean = false) => {
    bulkConfirmMutation.mutate({
      orderIds: Array.from(selectedOrders),
      skipUnmatched,
    });
  };

  return (
    <>
      <Header title="eBay Orders" />
      <div className="p-6 space-y-6">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">eBay Orders</h2>
            <p className="text-muted-foreground">
              View and manage orders from your eBay account
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => window.open('/api/picking-list/ebay?format=pdf', '_blank')}
              disabled={!statusSummary?.data?.Paid}
            >
              <ClipboardList className="mr-2 h-4 w-4" />
              Picking List
              <Download className="ml-2 h-4 w-4" />
            </Button>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync Orders
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Sync Result */}
        {syncMutation.isSuccess && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Sync complete: {syncMutation.data.results?.orders?.ordersProcessed || 0} orders processed
            </AlertDescription>
          </Alert>
        )}

        {/* Status Summary Cards */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card
            className={`cursor-pointer transition-colors ${status === 'all' ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
            onClick={() => setStatus('all')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">All Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statusSummary?.data?.all?.toLocaleString() || '0'}
              </div>
            </CardContent>
          </Card>

          {(['Paid', 'Packed', 'Completed', 'Refunded'] as const).map((s) => (
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

        {/* Orders Table Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Order History</CardTitle>
                <CardDescription>
                  Browse and manage your eBay orders
                </CardDescription>
              </div>

              {/* Bulk Actions */}
              {selectedOrders.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedOrders.size} selected
                  </span>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleBulkConfirm(false)}
                    disabled={bulkConfirmMutation.isPending}
                  >
                    {bulkConfirmMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckSquare className="mr-2 h-4 w-4" />
                    )}
                    Confirm Selected
                  </Button>
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

              <Select value={platform} onValueChange={handlePlatformChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  <SelectItem value="bricklink">BrickLink</SelectItem>
                  <SelectItem value="brickowl">Brick Owl</SelectItem>
                  <SelectItem value="bricqer">Bricqer</SelectItem>
                  <SelectItem value="ebay">eBay</SelectItem>
                </SelectContent>
              </Select>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                  <SelectItem value="Packed">Packed</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>

              <Select value={matchFilter} onValueChange={setMatchFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Match Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Match Status</SelectItem>
                  <SelectItem value="matched">Matched</SelectItem>
                  <SelectItem value="unmatched">Unmatched</SelectItem>
                  <SelectItem value="no_sku">No SKU</SelectItem>
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
                        checked={orders.length > 0 && selectedOrders.size === orders.length}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersLoading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : orders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No eBay orders found. Try syncing your orders.
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
                            aria-label={`Select order ${order.ebay_order_id}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {order.ebay_order_id}
                        </TableCell>
                        <TableCell>
                          <Link href="/orders">
                            <Badge variant="outline" className="capitalize cursor-pointer hover:bg-muted">
                              eBay
                            </Badge>
                          </Link>
                        </TableCell>
                        <TableCell>
                          {format(new Date(order.creation_date), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>{order.buyer_username}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground" title={order.line_items?.map((item) => item.title).filter(Boolean).join(', ') || '-'}>
                          {order.line_items?.map((item) => item.title).filter(Boolean).join(', ') || '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{order.line_items?.length || 0} item(s)</span>
                            {order.match_summary && (order.match_summary.unmatched || 0) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const unmatchedItems = order.line_items
                                    .filter((li) => li.match_status === 'unmatched' && li.sku)
                                    .map((li) => ({ sku: li.sku!, title: li.title }));
                                  const noSkuItems = order.line_items
                                    .filter((li) => li.match_status === 'no_sku')
                                    .map((li) => ({ sku: '', title: li.title }));
                                  setSelectedOrderUnmatchedItems([...unmatchedItems, ...noSkuItems]);
                                  setUnmatchedItemsDialogOpen(true);
                                }}
                                className="hover:opacity-80 transition-opacity cursor-pointer"
                              >
                                <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  {order.match_summary.unmatched} unmatched
                                </Badge>
                              </button>
                            )}
                            {order.match_summary && (order.match_summary.no_sku || 0) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const unmatchedItems = order.line_items
                                    .filter((li) => li.match_status === 'unmatched' && li.sku)
                                    .map((li) => ({ sku: li.sku!, title: li.title }));
                                  const noSkuItems = order.line_items
                                    .filter((li) => li.match_status === 'no_sku')
                                    .map((li) => ({ sku: '', title: li.title }));
                                  setSelectedOrderUnmatchedItems([...unmatchedItems, ...noSkuItems]);
                                  setUnmatchedItemsDialogOpen(true);
                                }}
                                className="hover:opacity-80 transition-opacity cursor-pointer"
                              >
                                <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  {order.match_summary.no_sku} No SKU
                                </Badge>
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(order.ui_status)}>
                            {order.ui_status}
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
                                <Link href={`/orders/ebay/${order.id}`}>
                                  View Details
                                </Link>
                              </DropdownMenuItem>
                              {order.ui_status === 'Paid' && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleConfirmOrder(order.id)}
                                    disabled={confirmMutation.isPending}
                                  >
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                    Confirm Order
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <a
                                  href={`https://www.ebay.co.uk/sh/ord/details?orderid=${order.ebay_order_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  View on eBay
                                </a>
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

      {/* Unmatched Items Warning Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              Unmatched Items Found
            </DialogTitle>
            <DialogDescription>
              The following items in this order could not be matched to inventory:
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ul className="list-disc list-inside space-y-1 text-sm">
              {unmatchedWarning?.map((item, i) => (
                <li key={i} className="text-muted-foreground">{item}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm">
              You can either match these items first, or confirm the order anyway
              (inventory won&apos;t be updated for unmatched items).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Link href="/settings/integrations">
              <Button variant="secondary">
                Match Items
              </Button>
            </Link>
            <Button onClick={handleConfirmWithSkip}>
              Confirm Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unmatched Items List Dialog */}
      <Dialog open={unmatchedItemsDialogOpen} onOpenChange={setUnmatchedItemsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              Unmatched Items
            </DialogTitle>
            <DialogDescription>
              These items need to be linked to inventory
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            {selectedOrderUnmatchedItems.filter((item) => item.sku).map((item, i) => (
              <button
                key={`sku-${i}`}
                type="button"
                className="w-full text-left p-3 rounded-md border hover:bg-muted transition-colors"
                onClick={() => {
                  setSelectedItemForMatching(item);
                  setUnmatchedItemsDialogOpen(false);
                  setSkuMatcherOpen(true);
                }}
              >
                <div className="font-medium text-sm">{item.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  SKU: <span className="font-mono">{item.sku}</span>
                </div>
                <div className="text-xs text-blue-600 mt-1">Click to link to inventory</div>
              </button>
            ))}
            {selectedOrderUnmatchedItems.filter((item) => !item.sku).map((item, i) => (
              <div
                key={`nosku-${i}`}
                className="w-full text-left p-3 rounded-md border bg-gray-50"
              >
                <div className="font-medium text-sm">{item.title}</div>
                <div className="text-xs text-orange-600 mt-1">
                  No SKU on eBay listing - add SKU in eBay to enable linking
                </div>
              </div>
            ))}
            {selectedOrderUnmatchedItems.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                All items are matched.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmatchedItemsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SKU Matcher Dialog */}
      {selectedItemForMatching && (
        <EbaySkuMatcherDialog
          open={skuMatcherOpen}
          onOpenChange={setSkuMatcherOpen}
          ebaySku={selectedItemForMatching.sku}
          itemTitle={selectedItemForMatching.title}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['ebay', 'orders'] });
            setSelectedItemForMatching(null);
          }}
        />
      )}
    </>
  );
}
