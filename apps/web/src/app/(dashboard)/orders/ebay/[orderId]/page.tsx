'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Package,
  User,
  MapPin,
  Clock,
  Check,
  X,
  Link2,
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
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useState } from 'react';
import { EbaySkuMatcherDialog } from '@/components/features/orders/EbaySkuMatcherDialog';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface LineItem {
  id: string;
  ebay_line_item_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  line_item_cost_amount: number;
  line_item_cost_currency: string;
  total_amount: number;
  total_currency: string;
  fulfilment_status: string;
  item_location: string | null;
  match_status: 'matched' | 'unmatched' | 'manual' | 'no_sku';
  matched_inventory: {
    id: string;
    sku: string;
    set_number: string;
    item_name: string;
    storage_location: string | null;
    status: string;
  } | null;
}

interface ShippingAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvince?: string;
  postalCode: string;
  country: string;
  phoneNumber?: string;
}

interface EbayOrderDetail {
  id: string;
  ebay_order_id: string;
  legacy_order_id: string | null;
  creation_date: string;
  last_modified_date: string;
  buyer_username: string;
  buyer_checkout_notes: string | null;
  order_fulfilment_status: string;
  order_payment_status: string;
  ui_status: 'Paid' | 'Packed' | 'Completed' | 'Refunded';
  total: number;
  currency: string;
  line_items: LineItem[];
  fulfilments: Array<{
    id: string;
    ebay_fulfilment_id: string;
    shipped_date: string;
    shipping_carrier_code: string;
    tracking_number: string;
  }>;
  shipping_address: ShippingAddress | null;
  shipping_service: string | null;
  pricing_summary: {
    total: { value: number; currency: string };
    subtotal?: { value: number; currency: string };
    deliveryCost?: { value: number; currency: string };
    tax?: { value: number; currency: string };
  };
}

async function fetchOrderDetail(orderId: string): Promise<{ data: EbayOrderDetail }> {
  const response = await fetch(`/api/orders/ebay/${orderId}`);
  if (!response.ok) throw new Error('Failed to fetch order');
  return response.json();
}

async function confirmOrder(orderId: string, skipUnmatched: boolean = false): Promise<{
  success: boolean;
  data?: { inventoryUpdated: number; unmatchedItems: number; isLateMatch?: boolean };
  error?: string;
  unmatchedItems?: string[];
}> {
  const response = await fetch(`/api/orders/ebay/${orderId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipUnmatched }),
  });
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

function getMatchStatusBadge(status: 'matched' | 'unmatched' | 'manual' | 'no_sku') {
  switch (status) {
    case 'matched':
      return <Badge className="bg-green-100 text-green-800"><Check className="h-3 w-3 mr-1" />Matched</Badge>;
    case 'manual':
      return <Badge className="bg-blue-100 text-blue-800"><Link2 className="h-3 w-3 mr-1" />Manual</Badge>;
    case 'unmatched':
      return <Badge className="bg-orange-100 text-orange-800"><X className="h-3 w-3 mr-1" />Unmatched</Badge>;
    case 'no_sku':
      return <Badge className="bg-gray-100 text-gray-600">No SKU</Badge>;
  }
}

function formatCurrency(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

export default function EbayOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const queryClient = useQueryClient();
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [unmatchedWarning, setUnmatchedWarning] = useState<string[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [skuMatcherOpen, setSkuMatcherOpen] = useState(false);
  const [selectedItemForMatching, setSelectedItemForMatching] = useState<{ sku: string; title: string } | null>(null);

  const { data: orderData, isLoading, error } = useQuery({
    queryKey: ['ebay', 'order', orderId],
    queryFn: () => fetchOrderDetail(orderId),
  });

  const confirmMutation = useMutation({
    mutationFn: (skipUnmatched: boolean) => confirmOrder(orderId, skipUnmatched),
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['ebay', 'order', orderId] });
        queryClient.invalidateQueries({ queryKey: ['ebay', 'orders'] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        setConfirmDialogOpen(false);
        setUnmatchedWarning(null);
        const isLateMatch = data.data?.isLateMatch;
        setSuccessMessage(
          isLateMatch
            ? `Inventory updated! ${data.data?.inventoryUpdated || 0} items marked as sold.`
            : `Order confirmed! ${data.data?.inventoryUpdated || 0} inventory items updated.`
        );
      } else if (data.unmatchedItems && data.unmatchedItems.length > 0) {
        setUnmatchedWarning(data.unmatchedItems);
        setConfirmDialogOpen(true);
      }
    },
  });

  const order = orderData?.data;

  if (isLoading) {
    return (
      <>
        <Header title="Order Details" />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (error || !order) {
    return (
      <>
        <Header title="Order Details" />
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load order details. {error?.message}
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const canConfirm = order.ui_status === 'Paid';
  const isAlreadyShipped = order.ui_status === 'Completed';
  const unmatchedCount = order.line_items.filter((li) => li.match_status === 'unmatched').length;
  // Check if there are matched items that might need inventory updates (for late matching)
  const hasMatchedItems = order.line_items.some(
    (li) => li.match_status === 'matched' || li.match_status === 'manual'
  );
  // Show "Update Inventory" button for shipped orders that have any matched items
  // (inventory may not have been updated if the matching was done after shipping)
  const canUpdateInventory = isAlreadyShipped && hasMatchedItems;

  return (
    <>
      <Header title="Order Details" />
      <div className="p-6 space-y-6">
        {/* Back Link & Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/orders/ebay">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Orders
              </Button>
            </Link>
          </div>
          <div className="flex gap-2">
            {canConfirm && (
              <Button
                onClick={() => confirmMutation.mutate(false)}
                disabled={confirmMutation.isPending}
              >
                {confirmMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirm Order
              </Button>
            )}
            {canUpdateInventory && (
              <Button
                variant="secondary"
                onClick={() => confirmMutation.mutate(false)}
                disabled={confirmMutation.isPending}
              >
                {confirmMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Update Inventory
              </Button>
            )}
            <a
              href={`https://www.ebay.co.uk/sh/ord/details?orderid=${order.ebay_order_id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline">
                <ExternalLink className="mr-2 h-4 w-4" />
                View on eBay
              </Button>
            </a>
          </div>
        </div>

        {/* Success Message */}
        {successMessage && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              {successMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Order Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Order {order.ebay_order_id}
                </CardTitle>
                <CardDescription className="mt-1">
                  Placed on {format(new Date(order.creation_date), 'PPP')} at{' '}
                  {format(new Date(order.creation_date), 'p')}
                </CardDescription>
              </div>
              <Badge className={getStatusColor(order.ui_status)} style={{ fontSize: '1rem', padding: '0.5rem 1rem' }}>
                {order.ui_status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              {/* Buyer Info */}
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <User className="h-4 w-4" /> Buyer
                </h4>
                <p className="font-medium">{order.buyer_username}</p>
                {order.buyer_checkout_notes && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Note: {order.buyer_checkout_notes}
                  </p>
                )}
              </div>

              {/* Shipping Address */}
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> Ship To
                </h4>
                {order.shipping_address ? (
                  <div className="text-sm">
                    <p className="font-medium">{order.shipping_address.name}</p>
                    <p>{order.shipping_address.addressLine1}</p>
                    {order.shipping_address.addressLine2 && (
                      <p>{order.shipping_address.addressLine2}</p>
                    )}
                    <p>
                      {order.shipping_address.city}
                      {order.shipping_address.stateOrProvince && `, ${order.shipping_address.stateOrProvince}`}
                    </p>
                    <p>{order.shipping_address.postalCode}, {order.shipping_address.country}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No shipping address</p>
                )}
              </div>

              {/* Order Summary */}
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Clock className="h-4 w-4" /> Summary
                </h4>
                <div className="space-y-1 text-sm">
                  {order.pricing_summary.subtotal && (
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{formatCurrency(order.pricing_summary.subtotal.value, order.pricing_summary.subtotal.currency)}</span>
                    </div>
                  )}
                  {order.pricing_summary.deliveryCost && (
                    <div className="flex justify-between">
                      <span>Shipping</span>
                      <span>{formatCurrency(order.pricing_summary.deliveryCost.value, order.pricing_summary.deliveryCost.currency)}</span>
                    </div>
                  )}
                  {order.pricing_summary.tax && (
                    <div className="flex justify-between">
                      <span>Tax</span>
                      <span>{formatCurrency(order.pricing_summary.tax.value, order.pricing_summary.tax.currency)}</span>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="flex justify-between font-medium">
                    <span>Total</span>
                    <span>{formatCurrency(order.total, order.currency)}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unmatched Warning */}
        {unmatchedCount > 0 && canConfirm && (
          <Alert className="bg-yellow-50 border-yellow-200">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              {unmatchedCount} item(s) in this order could not be matched to inventory.
              You can still confirm the order, but inventory won&apos;t be updated for unmatched items.
            </AlertDescription>
          </Alert>
        )}

        {/* Line Items */}
        <Card>
          <CardHeader>
            <CardTitle>Line Items</CardTitle>
            <CardDescription>
              {order.line_items.length} item(s) in this order
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">SKU</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-[80px] text-center">Qty</TableHead>
                    <TableHead className="w-[100px] text-right">Price</TableHead>
                    <TableHead className="w-[100px] text-right">Total</TableHead>
                    <TableHead className="w-[120px]">Location</TableHead>
                    <TableHead className="w-[100px]">Match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.line_items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">
                        {item.sku || '-'}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.title}</p>
                          {item.matched_inventory && (
                            <p className="text-xs text-muted-foreground">
                              → {item.matched_inventory.set_number || item.matched_inventory.sku}: {item.matched_inventory.item_name}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.line_item_cost_amount, item.line_item_cost_currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.total_amount, item.total_currency)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.matched_inventory?.storage_location || item.item_location || '-'}
                      </TableCell>
                      <TableCell>
                        {item.match_status === 'unmatched' && item.sku ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedItemForMatching({ sku: item.sku!, title: item.title });
                              setSkuMatcherOpen(true);
                            }}
                            className="hover:opacity-80 transition-opacity cursor-pointer"
                          >
                            {getMatchStatusBadge(item.match_status)}
                          </button>
                        ) : (
                          getMatchStatusBadge(item.match_status)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Fulfilments */}
        {order.fulfilments && order.fulfilments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Shipping History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {order.fulfilments.map((fulfilment) => (
                  <div key={fulfilment.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">
                          {fulfilment.shipping_carrier_code || 'Carrier'}: {fulfilment.tracking_number}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Shipped {format(new Date(fulfilment.shipped_date), 'PPP')}
                        </p>
                      </div>
                      <Badge className="bg-green-100 text-green-800">Shipped</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
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
              The following items could not be matched to inventory:
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
            <Button onClick={() => confirmMutation.mutate(true)}>
              Confirm Anyway
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
            queryClient.invalidateQueries({ queryKey: ['ebay', 'order', orderId] });
            setSelectedItemForMatching(null);
          }}
        />
      )}
    </>
  );
}
