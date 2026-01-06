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
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Package,
  Archive,
} from 'lucide-react';

interface OrderItemMatch {
  orderItemId: string;
  itemNumber: string;
  itemName: string;
  quantity: number;
  matchedInventoryId: string | null;
  matchedInventory: {
    id: string;
    set_number: string;
    item_name: string | null;
    storage_location: string | null;
    status: string | null;
  } | null;
  matchStatus: 'matched' | 'unmatched' | 'multiple';
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
}): Promise<ConfirmOrdersResponse> {
  const response = await fetch('/api/orders/confirm-fulfilled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to confirm orders');
  return response.json();
}

export function ConfirmOrdersDialog({
  open,
  onOpenChange,
  platform,
}: ConfirmOrdersDialogProps) {
  const queryClient = useQueryClient();
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [archiveLocation, setArchiveLocation] = useState(
    `SOLD-${new Date().toISOString().slice(0, 7)}`
  );
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', 'confirm', platform],
    queryFn: () => fetchOrdersForConfirmation(platform),
    enabled: open,
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

  // Filter orders based on showUnmatchedOnly
  const displayedOrders = showUnmatchedOnly
    ? orders.filter((o) => !o.allMatched)
    : orders;

  // Only allow confirming fully matched orders
  const matchedOrders = orders.filter((o) => o.allMatched);
  const selectedMatchedOrders = Array.from(selectedOrderIds).filter((id) =>
    matchedOrders.some((o) => o.orderId === id)
  );

  const handleSelectAll = () => {
    if (selectedMatchedOrders.length === matchedOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(matchedOrders.map((o) => o.orderId)));
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
    if (selectedMatchedOrders.length === 0) return;
    confirmMutation.mutate({
      orderIds: selectedMatchedOrders,
      archiveLocation,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Confirm Orders Processed - {platform === 'amazon' ? 'Amazon' : 'eBay'}
          </DialogTitle>
          <DialogDescription>
            Select orders to confirm as fulfilled. Matched inventory will be updated to
            SOLD status.
          </DialogDescription>
        </DialogHeader>

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
            <p className="text-sm mt-2">
              Orders must be in Shipped or Completed status to confirm.
            </p>
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
                onCheckedChange={(checked: boolean | 'indeterminate') => setShowUnmatchedOnly(checked === true)}
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
                          matchedOrders.length > 0 &&
                          selectedMatchedOrders.length === matchedOrders.length
                        }
                        onCheckedChange={handleSelectAll}
                        disabled={matchedOrders.length === 0}
                      />
                    </TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedOrders.map((order) => (
                    <TableRow
                      key={order.orderId}
                      className={selectedOrderIds.has(order.orderId) ? 'bg-muted/50' : ''}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedOrderIds.has(order.orderId)}
                          onCheckedChange={() => handleToggleOrder(order.orderId)}
                          disabled={!order.allMatched}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-sm">{order.platformOrderId}</div>
                        <div className="text-xs text-muted-foreground">
                          {order.buyerName || 'Unknown buyer'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {order.orderDate
                          ? format(new Date(order.orderDate), 'MMM d, yyyy')
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {order.items.map((item) => (
                            <div
                              key={item.orderItemId}
                              className="flex items-center gap-2 text-xs"
                            >
                              {getMatchStatusBadge(item.matchStatus)}
                              <span className="truncate max-w-[200px]" title={item.itemName}>
                                {item.itemNumber || 'No SKU'}: {item.itemName}
                              </span>
                              {item.matchedInventory && (
                                <span className="text-muted-foreground">
                                  @ {item.matchedInventory.storage_location || 'No location'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {order.allMatched ? (
                          <Badge className="bg-green-100 text-green-800">
                            Ready
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600">
                            {order.unmatchedCount} unmatched
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            {/* Unmatched Warning */}
            {summary && summary.partialMatchOrders + summary.unmatchedOrders > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {summary.partialMatchOrders + summary.unmatchedOrders} order(s) have
                  unmatched items. Update inventory ASIN/SKU mappings to enable
                  confirmation.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              selectedMatchedOrders.length === 0 ||
              confirmMutation.isPending ||
              isLoading
            }
          >
            {confirmMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Confirm {selectedMatchedOrders.length} Order
                {selectedMatchedOrders.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>

        {/* Success/Error Messages */}
        {confirmMutation.isSuccess && confirmMutation.data.success && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Successfully confirmed {confirmMutation.data.data.ordersProcessed} orders.
              Updated {confirmMutation.data.data.inventoryUpdated} inventory items to
              SOLD.
            </AlertDescription>
          </Alert>
        )}

        {confirmMutation.isSuccess &&
          confirmMutation.data.data.errors.length > 0 && (
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
      </DialogContent>
    </Dialog>
  );
}
