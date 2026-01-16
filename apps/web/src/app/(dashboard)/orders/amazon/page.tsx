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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AmazonAsinMatcherDialog } from '@/components/features/orders/AmazonAsinMatcherDialog';
import { LinkedInventoryPopover } from '@/components/features/orders/LinkedInventoryPopover';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface AmazonOrderItem {
  id: string;
  item_number: string | null;
  item_name: string | null;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  currency: string | null;
  condition: string | null;
  inventory_item_id: string | null;
  amazon_linked_at: string | null;
  amazon_link_method: string | null;
  match_status: 'matched' | 'unmatched' | 'no_asin' | 'linked';
}

interface AmazonOrder {
  id: string;
  platform_order_id: string;
  order_date: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  status: string | null;
  internal_status: string | null;
  ui_status: string;
  total: number | null;
  currency: string | null;
  notes: string | null;
  items: AmazonOrderItem[];
  match_summary: {
    total: number;
    unmatched: number;
    no_asin: number;
    linked: number;
    all_matched: boolean;
  };
}

interface AmazonOrdersResponse {
  data: AmazonOrder[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface AmazonStatusSummary {
  all: number;
  Pending: number;
  Paid: number;
  Shipped: number;
  Completed: number;
  Cancelled: number;
}

async function fetchAmazonOrders(
  page: number,
  status?: string,
  search?: string,
  matchFilter?: string
): Promise<AmazonOrdersResponse> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '20',
  });
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);
  if (matchFilter && matchFilter !== 'all') params.set('matchFilter', matchFilter);

  const response = await fetch(`/api/orders/amazon?${params}`);
  if (!response.ok) throw new Error('Failed to fetch Amazon orders');
  return response.json();
}

async function fetchAmazonStatusSummary(): Promise<{ data: AmazonStatusSummary }> {
  const response = await fetch('/api/orders/amazon/status-summary');
  if (!response.ok) throw new Error('Failed to fetch status summary');
  return response.json();
}

async function syncAmazonOrders(): Promise<{ success: boolean; results?: { ordersProcessed?: number } }> {
  const response = await fetch('/api/integrations/amazon/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'orders' }),
  });
  if (!response.ok) throw new Error('Failed to sync Amazon orders');
  return response.json();
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'Completed':
      return 'bg-green-100 text-green-800';
    case 'Shipped':
      return 'bg-blue-100 text-blue-800';
    case 'Paid':
      return 'bg-purple-100 text-purple-800';
    case 'Pending':
      return 'bg-yellow-100 text-yellow-800';
    case 'Cancelled':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatCurrency(amount: number | null, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount || 0);
}

export default function AmazonOrdersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('amazon');
  const [status, setStatus] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [asinMatcherOpen, setAsinMatcherOpen] = useState(false);
  const [selectedItemForMatching, setSelectedItemForMatching] = useState<{ asin: string; title: string; orderId: string } | null>(null);
  const [unmatchedItemsDialogOpen, setUnmatchedItemsDialogOpen] = useState(false);
  const [selectedOrderUnmatchedItems, setSelectedOrderUnmatchedItems] = useState<Array<{ asin: string; title: string; orderId: string }>>([]);

  // Handle platform change - redirect to appropriate page
  const handlePlatformChange = (newPlatform: string) => {
    if (newPlatform === 'ebay') {
      router.push('/orders/ebay');
    } else if (newPlatform !== 'amazon') {
      router.push(`/orders?platform=${newPlatform}`);
    } else {
      setPlatform(newPlatform);
    }
  };

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['amazon', 'orders', page, status, search, matchFilter],
    queryFn: () => fetchAmazonOrders(page, status, search, matchFilter),
  });

  const { data: statusSummary } = useQuery({
    queryKey: ['amazon', 'orders', 'status-summary'],
    queryFn: fetchAmazonStatusSummary,
    refetchInterval: 30000,
  });

  const syncMutation = useMutation({
    mutationFn: syncAmazonOrders,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amazon', 'orders'] });
    },
  });

  const orders = ordersData?.data || [];
  const pagination = ordersData?.pagination;

  return (
    <>
      <Header title="Amazon Orders" />
      <div className="p-6 space-y-6">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Amazon Orders</h2>
            <p className="text-muted-foreground">
              View and manage orders from your Amazon Seller account
            </p>
          </div>
          <div className="flex gap-2">
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
              Sync complete: {syncMutation.data.results?.ordersProcessed || 0} orders processed
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
                {statusSummary?.data?.all?.toLocaleString() || '0'}
              </div>
            </CardContent>
          </Card>

          {(['Pending', 'Paid', 'Shipped', 'Completed', 'Cancelled'] as const).map((s) => (
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
                  Browse and manage your Amazon orders
                </CardDescription>
              </div>
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
                  <SelectItem value="amazon">Amazon</SelectItem>
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
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                  <SelectItem value="Shipped">Shipped</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>

              <Select value={matchFilter} onValueChange={(value: string) => { setMatchFilter(value); setPage(1); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Match Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Match Status</SelectItem>
                  <SelectItem value="matched">Matched</SelectItem>
                  <SelectItem value="unmatched">Unmatched</SelectItem>
                  <SelectItem value="no_asin">No ASIN</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Orders Table */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
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
                        No Amazon orders found. Try syncing your orders.
                      </TableCell>
                    </TableRow>
                  ) : (
                    orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-sm">
                          {order.platform_order_id}
                        </TableCell>
                        <TableCell>
                          <Link href="/orders">
                            <Badge variant="outline" className="capitalize cursor-pointer hover:bg-muted">
                              Amazon
                            </Badge>
                          </Link>
                        </TableCell>
                        <TableCell>
                          {order.order_date
                            ? format(new Date(order.order_date), 'MMM d, yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell>{order.buyer_name || order.buyer_email || 'Amazon Customer'}</TableCell>
                        <TableCell
                          className="max-w-[200px] truncate text-sm text-muted-foreground"
                          title={order.items?.map((item) => item.item_name).filter(Boolean).join(', ') || order.notes || '-'}
                        >
                          {order.items?.map((item) => item.item_name).filter(Boolean).join(', ') || order.notes || '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{order.items?.length || 0} item(s)</span>
                            {order.match_summary && (order.match_summary.unmatched || 0) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const unmatchedItems = order.items
                                    .filter((item) => item.match_status === 'unmatched' && item.item_number)
                                    .map((item) => ({ asin: item.item_number!, title: item.item_name || 'Unknown Item', orderId: order.id }));
                                  const noAsinItems = order.items
                                    .filter((item) => item.match_status === 'no_asin')
                                    .map((item) => ({ asin: '', title: item.item_name || 'Unknown Item', orderId: order.id }));
                                  setSelectedOrderUnmatchedItems([...unmatchedItems, ...noAsinItems]);
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
                            {order.match_summary && (order.match_summary.no_asin || 0) > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const unmatchedItems = order.items
                                    .filter((item) => item.match_status === 'unmatched' && item.item_number)
                                    .map((item) => ({ asin: item.item_number!, title: item.item_name || 'Unknown Item', orderId: order.id }));
                                  const noAsinItems = order.items
                                    .filter((item) => item.match_status === 'no_asin')
                                    .map((item) => ({ asin: '', title: item.item_name || 'Unknown Item', orderId: order.id }));
                                  setSelectedOrderUnmatchedItems([...unmatchedItems, ...noAsinItems]);
                                  setUnmatchedItemsDialogOpen(true);
                                }}
                                className="hover:opacity-80 transition-opacity cursor-pointer"
                              >
                                <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  {order.match_summary.no_asin} No ASIN
                                </Badge>
                              </button>
                            )}
                            {order.match_summary && (order.match_summary.linked || 0) > 0 && (
                              <>
                                {order.items
                                  .filter((item) => item.match_status === 'linked' && item.inventory_item_id)
                                  .map((item) => (
                                    <LinkedInventoryPopover
                                      key={item.id}
                                      inventoryItemId={item.inventory_item_id!}
                                    >
                                      <Link
                                        href={`/inventory/${item.inventory_item_id}`}
                                        className="inline-flex"
                                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                      >
                                        <Badge
                                          variant="outline"
                                          className="text-green-600 border-green-300 bg-green-50 text-xs cursor-pointer hover:bg-green-100 transition-colors"
                                        >
                                          <CheckCircle2 className="h-3 w-3 mr-1" />
                                          {order.match_summary.linked === 1 ? '1 linked' : `linked`}
                                        </Badge>
                                      </Link>
                                    </LinkedInventoryPopover>
                                  ))}
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(order.ui_status)}>
                            {order.ui_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(order.total, order.currency || 'GBP')}
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
                                <Link href={`/orders/${order.id}`}>
                                  View Details
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <a
                                  href={`https://sellercentral.amazon.co.uk/orders-v3/order/${order.platform_order_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  View on Amazon
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
            {selectedOrderUnmatchedItems.filter((item) => item.asin).map((item, i) => (
              <button
                key={`asin-${i}`}
                type="button"
                className="w-full text-left p-3 rounded-md border hover:bg-muted transition-colors"
                onClick={() => {
                  setSelectedItemForMatching(item);
                  setUnmatchedItemsDialogOpen(false);
                  setAsinMatcherOpen(true);
                }}
              >
                <div className="font-medium text-sm">{item.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  ASIN: <span className="font-mono">{item.asin}</span>
                </div>
                <div className="text-xs text-blue-600 mt-1">Click to link to inventory</div>
              </button>
            ))}
            {selectedOrderUnmatchedItems.filter((item) => !item.asin).map((item, i) => (
              <div
                key={`noasin-${i}`}
                className="w-full text-left p-3 rounded-md border bg-gray-50"
              >
                <div className="font-medium text-sm">{item.title}</div>
                <div className="text-xs text-orange-600 mt-1">
                  No ASIN on Amazon order - cannot link to inventory
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

      {/* ASIN Matcher Dialog */}
      {selectedItemForMatching && (
        <AmazonAsinMatcherDialog
          open={asinMatcherOpen}
          onOpenChange={setAsinMatcherOpen}
          asin={selectedItemForMatching.asin}
          itemTitle={selectedItemForMatching.title}
          orderId={selectedItemForMatching.orderId}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['amazon', 'orders'] });
            setSelectedItemForMatching(null);
          }}
        />
      )}
    </>
  );
}
