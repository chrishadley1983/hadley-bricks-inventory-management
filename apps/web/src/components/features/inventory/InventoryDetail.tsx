'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Trash2, Package, Calendar, MapPin, DollarSign, ShoppingCart, Archive, Store, RotateCcw, Eye } from 'lucide-react';
import { useInventoryItem, useDeleteInventory, useUpdateInventory, usePurchase, usePerf, usePerfQuery } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/utils';
import { CreateEbayListingModal } from './CreateEbayListingModal';
import { EbayListingDetailsDialog } from './EbayListingDetailsDialog';

interface InventoryDetailProps {
  id: string;
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  'NOT YET RECEIVED': 'secondary',
  BACKLOG: 'default',
  LISTED: 'outline',
  SOLD: 'destructive',
};

export function InventoryDetail({ id }: InventoryDetailProps) {
  const router = useRouter();
  const { data: item, isLoading, error } = useInventoryItem(id);
  const deleteMutation = useDeleteInventory();
  const updateMutation = useUpdateInventory();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showResetEbayDialog, setShowResetEbayDialog] = useState(false);
  const [showCreateListingModal, setShowCreateListingModal] = useState(false);
  const [showListingDetailsDialog, setShowListingDetailsDialog] = useState(false);

  // Performance logging
  usePerf('InventoryDetail', isLoading);
  usePerfQuery('inventory-item', isLoading);

  // Fetch linked purchase if purchase_id exists
  const { data: linkedPurchase } = usePurchase(item?.purchase_id ?? undefined);

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/inventory');
  };

  const handleResetEbayListing = async () => {
    await updateMutation.mutateAsync({
      id,
      data: {
        ebay_listing_id: null,
        ebay_listing_url: null,
        status: 'BACKLOG',
      },
    });
    setShowResetEbayDialog(false);
  };

  if (isLoading) {
    return <InventoryDetailSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6 text-destructive">
        <h3 className="font-semibold">Error loading item</h3>
        <p>{error.message}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/inventory">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Inventory
          </Link>
        </Button>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <h3 className="font-semibold">Item not found</h3>
        <p className="text-muted-foreground">This inventory item does not exist.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/inventory">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Inventory
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/inventory">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <h1 className="text-2xl font-bold">{item.item_name || `Set ${item.set_number}`}</h1>
              <Badge variant={item.status ? STATUS_VARIANTS[item.status] || 'outline' : 'outline'}>{item.status || '-'}</Badge>
            </div>
            <p className="text-muted-foreground">Set #{item.set_number}</p>
          </div>
          <div className="flex gap-2">
            {/* Create eBay Listing button - disabled for LISTED or SOLD items */}
            <Button
              variant="default"
              onClick={() => setShowCreateListingModal(true)}
              disabled={item.status === 'LISTED' || item.status === 'SOLD' || !!item.ebay_listing_id}
            >
              <Store className="mr-2 h-4 w-4" />
              Create eBay Listing
            </Button>
            {/* View eBay Listing button - only show if item has eBay listing */}
            {item.ebay_listing_id && (
              <Button
                variant="outline"
                onClick={() => setShowListingDetailsDialog(true)}
              >
                <Eye className="mr-2 h-4 w-4" />
                View eBay Listing
              </Button>
            )}
            {/* Reset eBay Listing button - only show if item has eBay listing */}
            {item.ebay_listing_id && (
              <Button
                variant="outline"
                onClick={() => setShowResetEbayDialog(true)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset eBay
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/inventory/${id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Basic Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailRow label="Set Number" value={item.set_number} />
              <DetailRow label="Item Name" value={item.item_name} />
              <DetailRow
                label="Condition"
                value={
                  item.condition ? (
                    <Badge variant={item.condition === 'New' ? 'default' : 'secondary'}>
                      {item.condition}
                    </Badge>
                  ) : (
                    '-'
                  )
                }
              />
              <DetailRow label="Status" value={item.status} />
              <DetailRow label="SKU" value={item.sku} />
              <DetailRow label="Source" value={item.source} />
            </CardContent>
          </Card>

          {/* Financial Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Financial Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailRow label="Purchase Cost" value={item.cost ? formatCurrency(item.cost) : '-'} />
              <DetailRow
                label="Listing Value"
                value={item.listing_value ? formatCurrency(item.listing_value) : '-'}
              />
              {item.cost && item.listing_value && (
                <DetailRow
                  label="Potential Profit"
                  value={
                    <span
                      className={
                        item.listing_value - item.cost > 0 ? 'text-green-600' : 'text-red-600'
                      }
                    >
                      {formatCurrency(item.listing_value - item.cost)}
                    </span>
                  }
                />
              )}
              <DetailRow label="Listing Platform" value={item.listing_platform} />
              {item.listing_platform?.toLowerCase() === 'amazon' && (
                <DetailRow
                  label="Amazon ASIN"
                  value={
                    item.amazon_asin ? (
                      item.amazon_asin
                    ) : (
                      <span className="text-red-600 italic">Missing</span>
                    )
                  }
                />
              )}
            </CardContent>
          </Card>

          {/* Dates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Dates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailRow label="Purchase Date" value={formatDate(item.purchase_date)} />
              <DetailRow label="Listing Date" value={formatDate(item.listing_date)} />
              <DetailRow label="Created" value={formatDate(item.created_at)} />
              <DetailRow label="Last Updated" value={formatDate(item.updated_at)} />
            </CardContent>
          </Card>

          {/* Location & Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Location & Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailRow label="Storage Location" value={item.storage_location} />
              <DetailRow
                label="Linked Purchase"
                value={
                  linkedPurchase ? (
                    <Link
                      href={`/purchases/${linkedPurchase.id}`}
                      className="text-primary hover:underline"
                    >
                      {linkedPurchase.short_description}
                    </Link>
                  ) : item.linked_lot ? (
                    item.linked_lot
                  ) : null
                }
              />
              {item.notes && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Notes</dt>
                  <dd className="mt-1 text-sm whitespace-pre-wrap">{item.notes}</dd>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sales Information - Only show for SOLD items */}
          {item.status === 'SOLD' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Sales Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailRow label="Sold Date" value={formatDate(item.sold_date)} />
                <DetailRow label="Sold Platform" value={item.sold_platform} />
                <DetailRow label="Order ID" value={item.sold_order_id} />
                <DetailRow
                  label="Sold Price"
                  value={item.sold_price ? formatCurrency(item.sold_price) : '-'}
                />
                <DetailRow
                  label="Gross Amount"
                  value={item.sold_gross_amount ? formatCurrency(item.sold_gross_amount) : '-'}
                />
                <DetailRow
                  label="Postage Received"
                  value={item.sold_postage_received ? formatCurrency(item.sold_postage_received) : '-'}
                />
                <DetailRow
                  label="Fees"
                  value={
                    item.sold_fees_amount ? (
                      <span className="text-red-600">
                        -{formatCurrency(item.sold_fees_amount)}
                      </span>
                    ) : (
                      '-'
                    )
                  }
                />
                <DetailRow
                  label="Net Amount"
                  value={
                    item.sold_net_amount ? (
                      <span className="font-semibold text-green-600">
                        {formatCurrency(item.sold_net_amount)}
                      </span>
                    ) : (
                      '-'
                    )
                  }
                />
                {/* Calculate actual profit if we have cost and net amount */}
                {item.cost && item.sold_net_amount && (
                  <DetailRow
                    label="Actual Profit"
                    value={
                      <span
                        className={
                          item.sold_net_amount - item.cost > 0
                            ? 'font-semibold text-green-600'
                            : 'font-semibold text-red-600'
                        }
                      >
                        {formatCurrency(item.sold_net_amount - item.cost)}
                      </span>
                    }
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Archive Location - Only show for SOLD items with archive location */}
          {item.status === 'SOLD' && item.archive_location && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Archive className="h-5 w-5" />
                  Archive
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailRow label="Archive Location" value={item.archive_location} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Inventory Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{item.item_name || `Set ${item.set_number}`}
              &quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset eBay Listing Confirmation Dialog */}
      <Dialog open={showResetEbayDialog} onOpenChange={setShowResetEbayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset eBay Listing</DialogTitle>
            <DialogDescription>
              This will clear the eBay listing ID and URL from this item and reset its status to BACKLOG.
              The listing on eBay will NOT be affected - you must end it manually if needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetEbayDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleResetEbayListing}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Resetting...' : 'Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create eBay Listing Modal */}
      <CreateEbayListingModal
        open={showCreateListingModal}
        onOpenChange={setShowCreateListingModal}
        inventoryItem={{
          id: item.id,
          set_number: item.set_number,
          set_name: item.item_name,
          theme: item.listing_platform, // Theme not directly available, using platform as fallback
          condition: item.condition,
          listing_value: item.listing_value,
          status: item.status,
          ebay_listing_id: item.ebay_listing_id,
        }}
      />

      {/* eBay Listing Details Dialog */}
      <EbayListingDetailsDialog
        inventoryId={item.id}
        open={showListingDetailsDialog}
        onOpenChange={setShowListingDetailsDialog}
      />
    </>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value || '-'}</dd>
    </div>
  );
}

function InventoryDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-20" />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="flex justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
