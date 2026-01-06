'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Calendar,
  CreditCard,
  Store,
  FileText,
  Package,
  Plus,
} from 'lucide-react';
import { usePurchase, useDeletePurchase, useInventoryList } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/utils';
import { MileageSection } from './MileageSection';

interface PurchaseDetailProps {
  id: string;
}

export function PurchaseDetail({ id }: PurchaseDetailProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: purchase, isLoading, error } = usePurchase(id);
  const deleteMutation = useDeletePurchase();

  // Fetch linked inventory items (items with purchase date matching this purchase)
  const { data: inventoryData } = useInventoryList(
    { search: purchase?.reference || undefined },
    { page: 1, pageSize: 50 }
  );

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/purchases');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">Loading purchase...</div>
      </div>
    );
  }

  if (error || !purchase) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load purchase: {error?.message || 'Not found'}</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/purchases">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Purchases
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
                <Link href="/purchases">
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back
                </Link>
              </Button>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{purchase.short_description}</h1>
            <p className="text-muted-foreground">
              {formatDate(purchase.purchase_date)} &middot; {formatCurrency(purchase.cost)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/purchases/${id}/edit`}>
                <Edit className="mr-2 h-4 w-4" />
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Purchase Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Date
                  </span>
                  <span className="font-medium">{formatDate(purchase.purchase_date)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Store className="h-4 w-4" />
                    Source
                  </span>
                  {purchase.source ? (
                    <Badge variant="outline">{purchase.source}</Badge>
                  ) : (
                    <span>-</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Payment
                  </span>
                  <span className="font-medium">{purchase.payment_method || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cost</span>
                  <span className="text-lg font-bold">{formatCurrency(purchase.cost)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Additional Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {purchase.description && (
                <div>
                  <span className="text-sm text-muted-foreground">Description</span>
                  <p className="mt-1">{purchase.description}</p>
                </div>
              )}
              {purchase.reference && (
                <div>
                  <span className="text-sm text-muted-foreground">Reference</span>
                  <p className="mt-1 font-mono text-sm">{purchase.reference}</p>
                </div>
              )}
              {!purchase.description && !purchase.reference && (
                <p className="text-muted-foreground">No additional information</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Mileage & Travel Costs */}
        <MileageSection purchaseId={id} purchaseDate={purchase.purchase_date} />

        {/* Linked Inventory Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Linked Inventory Items
              </CardTitle>
              <CardDescription>Items associated with this purchase</CardDescription>
            </div>
            <Button asChild>
              <Link href={`/inventory/new?purchaseId=${id}`}>
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {inventoryData?.data && inventoryData.data.length > 0 ? (
              <div className="space-y-2">
                {inventoryData.data.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <Link
                        href={`/inventory/${item.id}`}
                        className="font-medium hover:underline"
                      >
                        {item.item_name || `Set ${item.set_number}`}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {item.set_number} &middot; {item.condition || 'Unknown'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        {item.cost ? formatCurrency(item.cost) : '-'}
                      </p>
                      <Badge variant="outline">{item.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-4 text-center">
                No inventory items linked to this purchase yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this purchase? This action cannot be undone.
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
    </>
  );
}
