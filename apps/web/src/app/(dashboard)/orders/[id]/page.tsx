'use client';

import dynamic from 'next/dynamic';
import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Package,
  User,
  MapPin,
  Truck,
  Calendar,
  CreditCard,
  Loader2,
  ExternalLink,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
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
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PlatformOrder, OrderItem, OrderStatus } from '@hadley-bricks/database';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface OrderWithItems extends PlatformOrder {
  items: OrderItem[];
}

interface OrderResponse {
  data: OrderWithItems;
}

interface StatusHistoryEntry {
  id: string;
  status: string;
  previous_status: string | null;
  changed_by: string | null;
  notes: string | null;
  created_at: string;
}

interface StatusResponse {
  data: {
    currentStatus: OrderStatus;
    platformStatus: string | null;
    allowedTransitions: OrderStatus[];
    history: StatusHistoryEntry[];
  };
}

async function fetchOrder(id: string): Promise<OrderResponse> {
  const response = await fetch(`/api/orders/${id}`);
  if (!response.ok) throw new Error('Failed to fetch order');
  return response.json();
}

async function fetchOrderStatus(id: string): Promise<StatusResponse> {
  const response = await fetch(`/api/orders/${id}/status`);
  if (!response.ok) throw new Error('Failed to fetch order status');
  return response.json();
}

async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  options?: { notes?: string; shipping?: { carrier?: string; trackingNumber?: string } }
): Promise<void> {
  const response = await fetch(`/api/orders/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...options }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to update status');
  }
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; icon: typeof Clock }> = {
  Pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  Paid: { label: 'Paid', color: 'bg-purple-100 text-purple-800', icon: CreditCard },
  Packed: { label: 'Packed', color: 'bg-blue-100 text-blue-800', icon: Package },
  Shipped: { label: 'Shipped', color: 'bg-cyan-100 text-cyan-800', icon: Truck },
  Completed: { label: 'Completed', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  Cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800', icon: XCircle },
};

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

interface ShippingAddress {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [showShipDialog, setShowShipDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [shippingCarrier, setShippingCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrder(id),
    enabled: !!id,
  });

  const { data: statusData } = useQuery({
    queryKey: ['order-status', id],
    queryFn: () => fetchOrderStatus(id),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      status,
      options,
    }: {
      status: OrderStatus;
      options?: { notes?: string; shipping?: { carrier?: string; trackingNumber?: string } };
    }) => updateOrderStatus(id, status, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['order-status', id] });
      setShowShipDialog(false);
      setShowCancelDialog(false);
      setShippingCarrier('');
      setTrackingNumber('');
      setCancelReason('');
    },
  });

  const order = data?.data;
  const currentStatus = statusData?.data?.currentStatus;
  const allowedTransitions = statusData?.data?.allowedTransitions || [];
  const statusHistory = statusData?.data?.history || [];

  const handleStatusChange = (newStatus: OrderStatus) => {
    if (newStatus === 'Shipped') {
      setShowShipDialog(true);
    } else if (newStatus === 'Cancelled') {
      setShowCancelDialog(true);
    } else {
      statusMutation.mutate({ status: newStatus });
    }
  };

  const handleShipSubmit = () => {
    statusMutation.mutate({
      status: 'Shipped',
      options: {
        shipping: {
          carrier: shippingCarrier || undefined,
          trackingNumber: trackingNumber || undefined,
        },
      },
    });
  };

  const handleCancelSubmit = () => {
    statusMutation.mutate({
      status: 'Cancelled',
      options: { notes: cancelReason || undefined },
    });
  };

  if (isLoading) {
    return (
      <>
        <Header title="Order Details" />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </>
    );
  }

  if (error || !order) {
    return (
      <>
        <Header title="Order Details" />
        <div className="p-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">Order not found</p>
            <Link href="/orders">
              <Button variant="link">Back to Orders</Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  const shippingAddress = order.shipping_address as ShippingAddress | null;

  return (
    <>
      <Header title={`Order ${order.platform_order_id}`} />
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Back Button & Header */}
        <div className="flex items-center gap-4">
          <Link href="/orders">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Orders
            </Button>
          </Link>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold">Order #{order.platform_order_id}</h2>
              <Badge className={getStatusColor(order.status)}>
                {order.status || 'Unknown'}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              <Badge variant="outline" className="capitalize mr-2">
                {order.platform}
              </Badge>
              {order.order_date &&
                format(new Date(order.order_date), 'MMMM d, yyyy \'at\' h:mm a')}
            </p>
          </div>

          {order.platform === 'bricklink' && (
            <a
              href={`https://www.bricklink.com/orderDetail.asp?ID=${order.platform_order_id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline">
                <ExternalLink className="mr-2 h-4 w-4" />
                View on BrickLink
              </Button>
            </a>
          )}
        </div>

        {/* Status Workflow Card */}
        {currentStatus && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Order Status Workflow
              </CardTitle>
              <CardDescription>
                Manage the order fulfillment process
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status Progression */}
              <div className="flex items-center gap-2 flex-wrap">
                {(['Pending', 'Paid', 'Packed', 'Shipped', 'Completed'] as OrderStatus[]).map(
                  (status, index) => {
                    const config = STATUS_CONFIG[status];
                    const Icon = config.icon;
                    const isActive = status === currentStatus;
                    const isPast =
                      ['Pending', 'Paid', 'Packed', 'Shipped', 'Completed'].indexOf(currentStatus) >
                      index;
                    const isCancelled = currentStatus === 'Cancelled';

                    return (
                      <div key={status} className="flex items-center">
                        <div
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm ${
                            isActive
                              ? config.color
                              : isPast && !isCancelled
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {config.label}
                        </div>
                        {index < 4 && (
                          <ChevronRight className="h-4 w-4 text-gray-400 mx-1" />
                        )}
                      </div>
                    );
                  }
                )}
                {currentStatus === 'Cancelled' && (
                  <div className="flex items-center">
                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm bg-red-100 text-red-800">
                      <XCircle className="h-3.5 w-3.5" />
                      Cancelled
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {allowedTransitions.length > 0 && (
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-sm text-muted-foreground mr-2">Actions:</span>
                  {allowedTransitions.map((nextStatus) => {
                    const config = STATUS_CONFIG[nextStatus];
                    return (
                      <Button
                        key={nextStatus}
                        variant={nextStatus === 'Cancelled' ? 'destructive' : 'default'}
                        size="sm"
                        onClick={() => handleStatusChange(nextStatus)}
                        disabled={statusMutation.isPending}
                      >
                        {statusMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <config.icon className="h-4 w-4 mr-1" />
                        )}
                        Mark as {config.label}
                      </Button>
                    );
                  })}
                </div>
              )}

              {/* Status History */}
              {statusHistory.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium mb-2">Status History</h4>
                  <div className="space-y-2">
                    {statusHistory.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="flex items-center text-sm">
                        <span className="text-muted-foreground w-40">
                          {format(new Date(entry.created_at), 'MMM d, h:mm a')}
                        </span>
                        <span>
                          {entry.previous_status && (
                            <>
                              <Badge variant="outline" className="text-xs">
                                {entry.previous_status}
                              </Badge>
                              <span className="mx-1">→</span>
                            </>
                          )}
                          <Badge className={STATUS_CONFIG[entry.status as OrderStatus]?.color || ''}>
                            {entry.status}
                          </Badge>
                        </span>
                        {entry.notes && (
                          <span className="ml-2 text-muted-foreground italic">
                            {entry.notes}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Order Info Cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Buyer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Buyer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{order.buyer_name || '-'}</p>
              </div>
              {order.buyer_email && (
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{order.buyer_email}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shipping Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4" />
                Shipping Address
              </CardTitle>
            </CardHeader>
            <CardContent>
              {shippingAddress ? (
                <address className="not-italic">
                  {shippingAddress.name && <p className="font-medium">{shippingAddress.name}</p>}
                  {shippingAddress.address1 && <p>{shippingAddress.address1}</p>}
                  {shippingAddress.address2 && <p>{shippingAddress.address2}</p>}
                  <p>
                    {[shippingAddress.city, shippingAddress.state, shippingAddress.postalCode]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  {shippingAddress.countryCode && <p>{shippingAddress.countryCode}</p>}
                </address>
              ) : (
                <p className="text-muted-foreground">No shipping address available</p>
              )}
            </CardContent>
          </Card>

          {/* Shipping Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4" />
                Shipping Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">Tracking Number</p>
                <p className="font-medium font-mono">
                  {order.tracking_number || 'Not provided'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Order Dates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Dates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">Order Date</p>
                <p className="font-medium">
                  {order.order_date
                    ? format(new Date(order.order_date), 'MMMM d, yyyy')
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Synced</p>
                <p className="font-medium">
                  {format(new Date(order.synced_at), 'MMMM d, yyyy \'at\' h:mm a')}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Order Items */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Order Items
            </CardTitle>
            <CardDescription>
              {order.items_count} item{order.items_count !== 1 ? 's' : ''} in this order
            </CardDescription>
          </CardHeader>
          <CardContent>
            {order.items && order.items.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.item_name || item.item_number}</p>
                            <p className="text-sm text-muted-foreground font-mono">
                              {item.item_number}
                            </p>
                            {item.color_name && (
                              <p className="text-sm text-muted-foreground">
                                Color: {item.color_name}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.item_type || '-'}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              item.condition === 'New'
                                ? 'bg-green-50 text-green-700'
                                : 'bg-blue-50 text-blue-700'
                            }
                          >
                            {item.condition || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unit_price, item.currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(item.total_price, item.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                No item details available. Try syncing with &quot;Include Items&quot; enabled.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Order Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Order Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(order.subtotal, order.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                <span>{formatCurrency(order.shipping, order.currency)}</span>
              </div>
              {order.fees !== null && order.fees > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fees</span>
                  <span>{formatCurrency(order.fees, order.currency)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{formatCurrency(order.total, order.currency)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ship Order Dialog */}
      <Dialog open={showShipDialog} onOpenChange={setShowShipDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ship Order</DialogTitle>
            <DialogDescription>
              Add tracking information for this shipment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="carrier">Shipping Carrier</Label>
              <Input
                id="carrier"
                placeholder="e.g., Royal Mail, DPD, Evri"
                value={shippingCarrier}
                onChange={(e) => setShippingCarrier(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tracking">Tracking Number</Label>
              <Input
                id="tracking"
                placeholder="Enter tracking number"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShipDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleShipSubmit} disabled={statusMutation.isPending}>
              {statusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Mark as Shipped
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Order Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this order? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Cancellation Reason (optional)</Label>
              <Textarea
                id="reason"
                placeholder="Enter reason for cancellation"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Go Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelSubmit}
              disabled={statusMutation.isPending}
            >
              {statusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Cancel Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
