'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Trash2, Package, Calendar, MapPin, DollarSign } from 'lucide-react';
import { useInventoryItem, useDeleteInventory } from '@/hooks';
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/inventory');
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
              <DetailRow label="Amazon ASIN" value={item.amazon_asin} />
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
              <DetailRow label="Linked Lot" value={item.linked_lot} />
              {item.notes && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Notes</dt>
                  <dd className="mt-1 text-sm whitespace-pre-wrap">{item.notes}</dd>
                </div>
              )}
            </CardContent>
          </Card>
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
