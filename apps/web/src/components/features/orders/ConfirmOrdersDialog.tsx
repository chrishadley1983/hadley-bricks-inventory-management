'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Package,
  Archive,
  Search,
  MapPin,
  ClipboardList,
} from 'lucide-react';

interface InventoryCandidate {
  id: string;
  set_number: string;
  item_name: string | null;
  storage_location: string | null;
  status: string | null;
  condition?: string | null;
  amazon_asin?: string | null;
  created_at?: string | null;
  isPickListRecommended?: boolean; // True for the first item (FIFO pick list selection)
}

interface OrderItemMatch {
  orderItemId: string;
  itemNumber: string;
  itemName: string;
  quantity: number;
  matchedInventoryId: string | null;
  matchedInventory: InventoryCandidate | null;
  matchStatus: 'matched' | 'unmatched' | 'multiple';
  matchCandidates?: InventoryCandidate[];
}

interface OrderMatchResult {
  orderId: string;
  platformOrderId: string;
  platform: string;
  buyerName: string | null;
  orderDate: string | null;
  total: number | null;
  items: OrderItemMatch[];
  allMatched: boolean;
  unmatchedCount: number;
}

interface OrdersForConfirmationResponse {
  data: {
    orders: OrderMatchResult[];
    summary: {
      totalOrders: number;
      allMatchedOrders: number;
      partialMatchOrders: number;
      unmatchedOrders: number;
      readyToConfirm: number;
    };
  };
}

interface ConfirmOrdersResponse {
  success: boolean;
  data: {
    ordersProcessed: number;
    inventoryUpdated: number;
    errors: string[];
  };
}

interface ConfirmOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: 'amazon' | 'ebay';
}

// eBay-specific types
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
  }>;
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

async function fetchOrdersForConfirmation(
  platform: 'amazon' | 'ebay'
): Promise<OrdersForConfirmationResponse> {
  const response = await fetch(`/api/orders/confirm-fulfilled?platform=${platform}`);
  if (!response.ok) throw new Error('Failed to fetch orders');
  return response.json();
}

async function confirmOrders(data: {
  orderIds: string[];
  archiveLocation?: string;
  itemMappings?: Record<string, string>;
}): Promise<ConfirmOrdersResponse> {
  const response = await fetch('/api/orders/confirm-fulfilled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to confirm orders');
  return response.json();
}

// eBay-specific API functions
async function fetchEbayOrders(status?: string, search?: string): Promise<EbayOrdersResponse> {
  const params = new URLSearchParams({ page: '1', pageSize: '50' });
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);

  const response = await fetch(`/api/orders/ebay?${params}`);
  if (!response.ok) throw new Error('Failed to fetch eBay orders');
  return response.json();
}

interface EbayBulkConfirmResult {
  orderId: string;
  success: boolean;
  error?: string;
  inventoryUpdated?: number;
}

interface EbayBulkConfirmResponse {
  success: boolean;
  error?: string;
  data?: {
    confirmed: number;
    failed: number;
    inventoryUpdated: number;
    results: EbayBulkConfirmResult[];
  };
}

async function confirmEbayBulkOrders(
  orderIds: string[],
  skipUnmatched: boolean = false
): Promise<EbayBulkConfirmResponse> {
  const response = await fetch('/api/orders/ebay/confirm-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderIds, skipUnmatched }),
  });
  // Don't throw on !ok - we want to handle error responses with details
  return response.json();
}

function formatCurrency(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

function getEbayStatusColor(status: string): string {
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

// eBay-specific confirmation content component
function EbayConfirmContent({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('Paid');
  const [searchQuery, setSearchQuery] = useState('');
  // Track orders that failed due to unmatched items for "confirm anyway" flow
  const [unmatchedFailedOrders, setUnmatchedFailedOrders] = useState<
    Array<{
      orderId: string;
      error: string;
      ebayOrderId?: string;
      buyerUsername?: string;
      itemTitles?: string[];
    }>
  >([]);
  const [selectedUnmatchedIds, setSelectedUnmatchedIds] = useState<Set<string>>(new Set());

  const {
    data: ordersData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['ebay', 'orders', 'confirm-dialog', statusFilter, searchQuery],
    queryFn: () => fetchEbayOrders(statusFilter, searchQuery),
    refetchOnWindowFocus: false,
  });

  const confirmMutation = useMutation({
    mutationFn: ({ orderIds, skipUnmatched }: { orderIds: string[]; skipUnmatched: boolean }) =>
      confirmEbayBulkOrders(orderIds, skipUnmatched),
    onSuccess: (result, variables) => {
      // Always invalidate queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['ebay', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });

      // Only close dialog and clear selection if all orders confirmed successfully
      if (result.success && result.data && result.data.confirmed > 0) {
        setSelectedOrderIds(new Set());
        setUnmatchedFailedOrders([]);
        setSelectedUnmatchedIds(new Set());
        onOpenChange(false);
      }
      // If partial success or failure, track unmatched failures for retry
      else if (result.data && result.data.results) {
        const unmatchedFails = result.data.results.filter(
          (r) => !r.success && r.error?.includes('unmatched')
        );

        // If this was a skipUnmatched=true request, those should have succeeded
        // Only track failures from initial (skipUnmatched=false) attempts
        if (!variables.skipUnmatched && unmatchedFails.length > 0) {
          // Enrich with order details from the orders list
          setUnmatchedFailedOrders(
            unmatchedFails.map((r) => {
              const order = orders.find((o) => o.id === r.orderId);
              return {
                orderId: r.orderId,
                error: r.error || 'Unmatched items',
                ebayOrderId: order?.ebay_order_id,
                buyerUsername: order?.buyer_username,
                itemTitles: order?.line_items?.map((li) => li.title) || [],
              };
            })
          );
          // Pre-select all unmatched failed orders
          setSelectedUnmatchedIds(new Set(unmatchedFails.map((r) => r.orderId)));
        }

        // Clear successful orders from main selection
        if (result.data.confirmed > 0) {
          const failedIds = new Set(
            result.data.results.filter((r) => !r.success).map((r) => r.orderId)
          );
          setSelectedOrderIds(failedIds);
        }
      }
    },
  });

  const orders = ordersData?.data || [];

  const handleSelectAll = () => {
    if (selectedOrderIds.size === orders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(orders.map((o) => o.id)));
    }
  };

  const handleToggleOrder = (orderId: string) => {
    const newSelection = new Set(selectedOrderIds);
    if (newSelection.has(orderId)) {
      newSelection.delete(orderId);
    } else {
      newSelection.add(orderId);
    }
    setSelectedOrderIds(newSelection);
  };

  const handleConfirm = () => {
    if (selectedOrderIds.size === 0) return;
    // Clear any previous unmatched failures before new attempt
    setUnmatchedFailedOrders([]);
    setSelectedUnmatchedIds(new Set());
    confirmMutation.mutate({ orderIds: Array.from(selectedOrderIds), skipUnmatched: false });
  };

  const handleConfirmAnyway = () => {
    if (selectedUnmatchedIds.size === 0) return;
    confirmMutation.mutate({ orderIds: Array.from(selectedUnmatchedIds), skipUnmatched: true });
  };

  const handleToggleUnmatchedOrder = (orderId: string) => {
    const newSelection = new Set(selectedUnmatchedIds);
    if (newSelection.has(orderId)) {
      newSelection.delete(orderId);
    } else {
      newSelection.add(orderId);
    }
    setSelectedUnmatchedIds(newSelection);
  };

  const handleSelectAllUnmatched = () => {
    if (selectedUnmatchedIds.size === unmatchedFailedOrders.length) {
      setSelectedUnmatchedIds(new Set());
    } else {
      setSelectedUnmatchedIds(new Set(unmatchedFailedOrders.map((o) => o.orderId)));
    }
  };

  const handleDismissUnmatched = () => {
    setUnmatchedFailedOrders([]);
    setSelectedUnmatchedIds(new Set());
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Paid">Paid</SelectItem>
            <SelectItem value="Packed">Packed</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Failed to load eBay orders. Please try again.</AlertDescription>
        </Alert>
      ) : orders.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          <Package className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p>No eBay orders found.</p>
          <p className="text-sm mt-2">Try changing the status filter or syncing your orders.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span>
                {orders.length} order{orders.length !== 1 ? 's' : ''} found
              </span>
            </div>
            {selectedOrderIds.size > 0 && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{selectedOrderIds.size} selected</span>
              </div>
            )}
          </div>

          {/* Orders Table */}
          <ScrollArea className="h-[300px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={orders.length > 0 && selectedOrderIds.size === orders.length}
                      onCheckedChange={handleSelectAll}
                      disabled={orders.length === 0}
                    />
                  </TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow
                    key={order.id}
                    className={selectedOrderIds.has(order.id) ? 'bg-muted/50' : ''}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedOrderIds.has(order.id)}
                        onCheckedChange={() => handleToggleOrder(order.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">{order.ebay_order_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {order.buyer_username || 'Unknown buyer'}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(order.creation_date), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {order.line_items?.slice(0, 3).map((item) => (
                          <div
                            key={item.id}
                            className="text-xs truncate max-w-[200px]"
                            title={item.title}
                          >
                            {item.sku ? `${item.sku}: ` : ''}
                            {item.title} x{item.quantity}
                          </div>
                        ))}
                        {order.line_items && order.line_items.length > 3 && (
                          <div className="text-xs text-muted-foreground">
                            +{order.line_items.length - 3} more item(s)
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getEbayStatusColor(order.ui_status)}>
                        {order.ui_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(order.total, order.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </>
      )}

      {/* Success Message - Full success */}
      {confirmMutation.isSuccess && confirmMutation.data.success && confirmMutation.data.data && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Successfully confirmed {confirmMutation.data.data.confirmed} order(s).
            {confirmMutation.data.data.inventoryUpdated > 0 && (
              <span>
                {' '}
                Updated {confirmMutation.data.data.inventoryUpdated} inventory item(s) to SOLD.
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Unmatched Items - Confirm Anyway UI */}
      {unmatchedFailedOrders.length > 0 && (
        <Alert className="border-yellow-300 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription>
            <div className="font-medium text-yellow-800">
              {unmatchedFailedOrders.length} order(s) have unmatched items
            </div>
            <p className="text-sm text-yellow-700 mt-1">
              These orders have items that couldn&apos;t be matched to inventory. You can confirm
              them anyway (inventory won&apos;t be updated for unmatched items).
            </p>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="selectAllUnmatched"
                    checked={
                      unmatchedFailedOrders.length > 0 &&
                      selectedUnmatchedIds.size === unmatchedFailedOrders.length
                    }
                    onCheckedChange={handleSelectAllUnmatched}
                  />
                  <Label
                    htmlFor="selectAllUnmatched"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Select all
                  </Label>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDismissUnmatched}
                    disabled={confirmMutation.isPending}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirmAnyway}
                    disabled={selectedUnmatchedIds.size === 0 || confirmMutation.isPending}
                  >
                    {confirmMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        Confirming...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-3 w-3" />
                        Confirm {selectedUnmatchedIds.size} Anyway
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="border rounded-md bg-white max-h-40 overflow-y-auto">
                {unmatchedFailedOrders.map((order) => (
                  <div
                    key={order.orderId}
                    className="flex items-start gap-3 px-3 py-2 border-b last:border-b-0"
                  >
                    <Checkbox
                      className="mt-1"
                      checked={selectedUnmatchedIds.has(order.orderId)}
                      onCheckedChange={() => handleToggleUnmatchedOrder(order.orderId)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {order.ebayOrderId || order.orderId.slice(0, 8)}
                        </span>
                        {order.buyerUsername && (
                          <span className="text-xs text-muted-foreground">
                            ({order.buyerUsername})
                          </span>
                        )}
                      </div>
                      {order.itemTitles && order.itemTitles.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {order.itemTitles.slice(0, 2).join(', ')}
                          {order.itemTitles.length > 2 && ` +${order.itemTitles.length - 2} more`}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Partial Success - Non-unmatched failures */}
      {confirmMutation.isSuccess &&
        !confirmMutation.data.success &&
        confirmMutation.data.data &&
        confirmMutation.data.data.results.some(
          (r) => !r.success && !r.error?.includes('unmatched')
        ) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="font-medium">
                {confirmMutation.data.data.confirmed} order(s) confirmed,{' '}
                {
                  confirmMutation.data.data.results.filter(
                    (r) => !r.success && !r.error?.includes('unmatched')
                  ).length
                }{' '}
                failed.
              </div>
              <ul className="list-disc list-inside mt-2 text-sm">
                {confirmMutation.data.data.results
                  .filter((r) => !r.success && !r.error?.includes('unmatched'))
                  .map((r) => (
                    <li key={r.orderId}>
                      Order {r.orderId.slice(0, 8)}...: {r.error || 'Unknown error'}
                    </li>
                  ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

      {/* API Error - No data returned */}
      {confirmMutation.isSuccess && confirmMutation.data.error && !confirmMutation.data.data && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-medium">Failed to confirm orders</div>
            <div className="text-sm mt-1">{confirmMutation.data.error}</div>
          </AlertDescription>
        </Alert>
      )}

      {/* Mutation Error - Network/fetch error */}
      {confirmMutation.isError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-medium">Request failed</div>
            <div className="text-sm mt-1">
              {confirmMutation.error instanceof Error
                ? confirmMutation.error.message
                : 'An unexpected error occurred. Please try again.'}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={selectedOrderIds.size === 0 || confirmMutation.isPending || isLoading}
        >
          {confirmMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Confirming...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirm {selectedOrderIds.size} Order{selectedOrderIds.size !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Amazon-specific confirmation content component
function AmazonConfirmContent({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [archiveLocation, setArchiveLocation] = useState(
    `SOLD-${new Date().toISOString().slice(0, 7)}`
  );
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  // Track manual inventory selections for items with multiple matches
  // Key: orderItemId, Value: inventoryId
  const [itemMappings, setItemMappings] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', 'confirm', 'amazon'],
    queryFn: () => fetchOrdersForConfirmation('amazon'),
    refetchOnWindowFocus: false,
  });

  const confirmMutation = useMutation({
    mutationFn: confirmOrders,
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        queryClient.invalidateQueries({ queryKey: ['platforms'] });
        setSelectedOrderIds(new Set());
        onOpenChange(false);
      }
    },
  });

  const orders = data?.data?.orders ?? [];
  const summary = data?.data?.summary;

  const displayedOrders = showUnmatchedOnly ? orders.filter((o) => !o.allMatched) : orders;

  // Helper function to check if an item is resolved (matched or manually selected)
  const isItemResolved = (item: OrderItemMatch): boolean => {
    if (item.matchStatus === 'matched') return true;
    if (item.matchStatus === 'multiple' && itemMappings[item.orderItemId]) return true;
    return false;
  };

  // Helper function to check if an order is fully resolved (all items matched or selected)
  const isOrderResolved = (order: OrderMatchResult): boolean => {
    return order.items.every(isItemResolved);
  };

  // Orders that are ready to confirm (all items resolved)
  const resolvedOrders = orders.filter(isOrderResolved);
  const selectedResolvedOrders = Array.from(selectedOrderIds).filter((id) =>
    resolvedOrders.some((o) => o.orderId === id)
  );

  // Handle selecting an inventory item for a "multiple" item
  const handleSelectInventory = (orderItemId: string, inventoryId: string) => {
    setItemMappings((prev) => ({
      ...prev,
      [orderItemId]: inventoryId,
    }));
  };

  const handleSelectAll = () => {
    if (selectedResolvedOrders.length === resolvedOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(resolvedOrders.map((o) => o.orderId)));
    }
  };

  const handleToggleOrder = (orderId: string) => {
    const newSelection = new Set(selectedOrderIds);
    if (newSelection.has(orderId)) {
      newSelection.delete(orderId);
    } else {
      newSelection.add(orderId);
    }
    setSelectedOrderIds(newSelection);
  };

  const handleConfirm = () => {
    if (selectedResolvedOrders.length === 0) return;
    confirmMutation.mutate({
      orderIds: selectedResolvedOrders,
      archiveLocation,
      itemMappings: Object.keys(itemMappings).length > 0 ? itemMappings : undefined,
    });
  };

  const getMatchStatusBadge = (status: 'matched' | 'unmatched' | 'multiple') => {
    switch (status) {
      case 'matched':
        return (
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Matched
          </Badge>
        );
      case 'unmatched':
        return (
          <Badge className="bg-red-100 text-red-800">
            <XCircle className="mr-1 h-3 w-3" />
            Unmatched
          </Badge>
        );
      case 'multiple':
        return (
          <Badge className="bg-yellow-100 text-yellow-800">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Multiple
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Failed to load orders. Please try again.</AlertDescription>
        </Alert>
      ) : orders.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          <Package className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p>No orders ready for confirmation.</p>
          <p className="text-sm mt-2">Orders must be in Shipped or Completed status to confirm.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{summary?.allMatchedOrders || 0} fully matched</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span>{summary?.partialMatchOrders || 0} partial</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span>{summary?.unmatchedOrders || 0} unmatched</span>
            </div>
          </div>

          {/* Filter Toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="showUnmatched"
              checked={showUnmatchedOnly}
              onCheckedChange={(checked: boolean | 'indeterminate') =>
                setShowUnmatchedOnly(checked === true)
              }
            />
            <Label htmlFor="showUnmatched" className="text-sm cursor-pointer">
              Show only orders with unmatched items
            </Label>
          </div>

          {/* Archive Location */}
          <div className="flex items-center gap-4">
            <Label htmlFor="archiveLocation" className="whitespace-nowrap">
              <Archive className="inline h-4 w-4 mr-1" />
              Archive Location:
            </Label>
            <Input
              id="archiveLocation"
              value={archiveLocation}
              onChange={(e) => setArchiveLocation(e.target.value)}
              placeholder="e.g., SOLD-2025-01"
              className="max-w-xs"
            />
          </div>

          {/* Orders Table */}
          <ScrollArea className="h-[400px] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={
                        resolvedOrders.length > 0 &&
                        selectedResolvedOrders.length === resolvedOrders.length
                      }
                      onCheckedChange={handleSelectAll}
                      disabled={resolvedOrders.length === 0}
                    />
                  </TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedOrders.map((order) => {
                  const orderResolved = isOrderResolved(order);
                  return (
                    <TableRow
                      key={order.orderId}
                      className={selectedOrderIds.has(order.orderId) ? 'bg-muted/50' : ''}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedOrderIds.has(order.orderId)}
                          onCheckedChange={() => handleToggleOrder(order.orderId)}
                          disabled={!orderResolved}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-sm">{order.platformOrderId}</div>
                        <div className="text-xs text-muted-foreground">
                          {order.buyerName || 'Unknown buyer'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {order.orderDate ? format(new Date(order.orderDate), 'MMM d, yyyy') : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          {order.items.map((item) => {
                            const selectedInventoryId = itemMappings[item.orderItemId];
                            const selectedCandidate = selectedInventoryId
                              ? item.matchCandidates?.find((c) => c.id === selectedInventoryId)
                              : null;
                            const displayInventory = item.matchedInventory || selectedCandidate;

                            return (
                              <div key={item.orderItemId} className="space-y-1">
                                <div className="flex items-center gap-2 text-xs">
                                  {/* Show badge based on resolution status */}
                                  {item.matchStatus === 'matched' ? (
                                    getMatchStatusBadge('matched')
                                  ) : item.matchStatus === 'multiple' && selectedInventoryId ? (
                                    <Badge className="bg-green-100 text-green-800">
                                      <CheckCircle2 className="mr-1 h-3 w-3" />
                                      Selected
                                    </Badge>
                                  ) : (
                                    getMatchStatusBadge(item.matchStatus)
                                  )}
                                  <span className="truncate max-w-[150px]" title={item.itemName}>
                                    {item.itemNumber || 'No SKU'}: {item.itemName}
                                  </span>
                                </div>

                                {/* Show storage location for matched/selected items */}
                                {displayInventory && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground ml-4">
                                    <MapPin className="h-3 w-3" />
                                    <span>
                                      {displayInventory.storage_location || 'No location'}
                                    </span>
                                    {/* Show pick list indicator if item was pre-linked (matched from pick list) */}
                                    {item.matchStatus === 'matched' && item.matchedInventory && (
                                      <span
                                        className="flex items-center gap-1 text-blue-600 ml-2"
                                        title="Pre-linked via pick list"
                                      >
                                        <ClipboardList className="h-3 w-3" />
                                        Pick list
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Show dropdown for multiple matches */}
                                {item.matchStatus === 'multiple' &&
                                  item.matchCandidates &&
                                  item.matchCandidates.length > 0 && (
                                    <div className="ml-4">
                                      <Select
                                        value={selectedInventoryId || ''}
                                        onValueChange={(value: string) =>
                                          handleSelectInventory(item.orderItemId, value)
                                        }
                                      >
                                        <SelectTrigger className="h-8 text-xs w-[320px]">
                                          <SelectValue
                                            placeholder={`Select from ${item.matchCandidates.length} options...`}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {item.matchCandidates.map((candidate, index) => (
                                            <SelectItem key={candidate.id} value={candidate.id}>
                                              <div className="flex items-center gap-2">
                                                {/* First item is the FIFO pick list recommendation */}
                                                {index === 0 && (
                                                  <span
                                                    className="flex items-center gap-1 text-blue-600"
                                                    title="Pick list recommended (FIFO)"
                                                  >
                                                    <ClipboardList className="h-3 w-3" />
                                                  </span>
                                                )}
                                                <span className="font-mono text-xs">
                                                  {candidate.set_number ||
                                                    candidate.item_name ||
                                                    candidate.id.slice(0, 8)}
                                                </span>
                                                {candidate.storage_location && (
                                                  <span className="flex items-center gap-1 text-muted-foreground">
                                                    <MapPin className="h-3 w-3" />
                                                    {candidate.storage_location}
                                                  </span>
                                                )}
                                                {candidate.condition && (
                                                  <Badge
                                                    variant="outline"
                                                    className="text-xs py-0 h-4"
                                                  >
                                                    {candidate.condition}
                                                  </Badge>
                                                )}
                                              </div>
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {orderResolved ? (
                          <Badge className="bg-green-100 text-green-800">Ready</Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600">
                            {order.items.filter((i) => !isItemResolved(i)).length} need selection
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Orders with multiple matches info */}
          {orders.some((o) => o.items.some((i) => i.matchStatus === 'multiple')) && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Some orders have items with multiple inventory matches. Use the dropdown to select
                which inventory item to use for each. Storage locations are shown to help identify
                the correct item.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* Success/Error Messages */}
      {confirmMutation.isSuccess && confirmMutation.data.success && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Successfully confirmed {confirmMutation.data.data.ordersProcessed} orders. Updated{' '}
            {confirmMutation.data.data.inventoryUpdated} inventory items to SOLD.
          </AlertDescription>
        </Alert>
      )}

      {confirmMutation.isSuccess && confirmMutation.data.data.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Some errors occurred:
            <ul className="list-disc list-inside mt-1">
              {confirmMutation.data.data.errors.map((err, i) => (
                <li key={i} className="text-sm">
                  {err}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={selectedResolvedOrders.length === 0 || confirmMutation.isPending || isLoading}
        >
          {confirmMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Confirming...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirm {selectedResolvedOrders.length} Order
              {selectedResolvedOrders.length !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ConfirmOrdersDialog({ open, onOpenChange, platform }: ConfirmOrdersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Confirm Orders Processed - {platform === 'amazon' ? 'Amazon' : 'eBay'}
          </DialogTitle>
          <DialogDescription>
            Select orders to confirm as fulfilled. Matched inventory will be updated to SOLD status.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {platform === 'ebay' ? (
            <EbayConfirmContent onOpenChange={onOpenChange} />
          ) : (
            <AmazonConfirmContent onOpenChange={onOpenChange} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
