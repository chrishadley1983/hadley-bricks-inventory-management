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
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Upload,
  Link2,
  ExternalLink,
  Unlink,
} from 'lucide-react';
import {
  usePurchase,
  useDeletePurchase,
  useInventoryList,
  usePurchaseProfitability,
} from '@/hooks';
import {
  useBrickLinkUploadsByPurchase,
  useUpdateBrickLinkUpload,
} from '@/hooks/use-bricklink-uploads';
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
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { MileageSection } from './MileageSection';
import { PurchaseImages } from './PurchaseImages';
import { PurchaseProfitability } from './PurchaseProfitability';
import { LinkUploadDialog } from './LinkUploadDialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

interface PurchaseDetailProps {
  id: string;
}

export function PurchaseDetail({ id }: PurchaseDetailProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showLinkUploadDialog, setShowLinkUploadDialog] = useState(false);
  const [uploadToUnlink, setUploadToUnlink] = useState<string | null>(null);

  const { data: purchase, isLoading, error } = usePurchase(id);
  const deleteMutation = useDeletePurchase();
  const { data: profitabilityData } = usePurchaseProfitability(id);

  // Fetch linked inventory items by purchase_id foreign key
  const { data: inventoryData } = useInventoryList({ purchaseId: id }, { page: 1, pageSize: 50 });

  // Fetch linked BrickLink uploads
  const { data: uploadsData } = useBrickLinkUploadsByPurchase(id);
  const updateUploadMutation = useUpdateBrickLinkUpload();

  // Create a map of item profitability data for quick lookup
  const itemProfitMap = new Map(profitabilityData?.items?.map((item) => [item.id, item]) ?? []);

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/purchases');
  };

  const handleUnlinkUpload = async (uploadId: string) => {
    await updateUploadMutation.mutateAsync({ id: uploadId, data: { purchase_id: null } });
    setUploadToUnlink(null);
  };

  const handleLinkUpload = async (uploadId: string) => {
    await updateUploadMutation.mutateAsync({ id: uploadId, data: { purchase_id: id } });
    setShowLinkUploadDialog(false);
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

              {/* Collapsible Notes Section */}
              {(purchase.description || purchase.reference) && (
                <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full pt-3 border-t">
                    <ChevronDown
                      className={cn('h-4 w-4 transition-transform', notesOpen && 'rotate-180')}
                    />
                    Notes & Reference
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3 space-y-3">
                    {purchase.description && (
                      <div>
                        <span className="text-xs text-muted-foreground">Description</span>
                        <p className="text-sm mt-0.5">{purchase.description}</p>
                      </div>
                    )}
                    {purchase.reference && (
                      <div>
                        <span className="text-xs text-muted-foreground">Reference</span>
                        <p className="text-sm font-mono mt-0.5">{purchase.reference}</p>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>

          {/* Profitability Section */}
          <PurchaseProfitability purchaseId={id} />
        </div>

        {/* Photos & Receipts */}
        <PurchaseImages purchaseId={id} />

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
                {inventoryData.data.map((item) => {
                  const profitData = itemProfitMap.get(item.id);
                  const isSold = item.status?.toUpperCase() === 'SOLD';
                  const hasListing = item.listing_value && item.listing_value > 0;
                  const profit = isSold ? profitData?.soldProfit : profitData?.projectedProfit;
                  const margin = isSold
                    ? profitData?.soldMarginPercent
                    : profitData?.projectedMarginPercent;
                  const hasCost = profitData?.hasCost ?? (item.cost !== null && item.cost > 0);

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/inventory/${item.id}`}
                            className="font-medium hover:underline truncate"
                          >
                            {item.item_name || `Set ${item.set_number}`}
                          </Link>
                          {!hasCost && (
                            <span title="No cost assigned">
                              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {item.set_number} &middot; {item.condition || 'Unknown'}
                        </p>
                      </div>

                      <div className="flex items-center gap-4">
                        {/* Cost */}
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Cost</p>
                          <p className="font-medium">
                            {item.cost ? formatCurrency(item.cost) : '-'}
                          </p>
                        </div>

                        {/* Sale/Listing Value */}
                        {isSold ? (
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              {item.sold_gross_amount ? 'Sold' : 'Sold (est.)'}
                            </p>
                            <p className="font-medium">
                              {item.sold_gross_amount
                                ? formatCurrency(item.sold_gross_amount)
                                : profitData?.soldGrossAmount
                                  ? formatCurrency(profitData.soldGrossAmount)
                                  : '-'}
                            </p>
                          </div>
                        ) : hasListing && item.listing_value ? (
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Listed</p>
                            <p className="font-medium">{formatCurrency(item.listing_value)}</p>
                          </div>
                        ) : null}

                        {/* Profit */}
                        {hasCost && profit !== null && profit !== undefined && (
                          <div className="text-right min-w-[80px]">
                            <p className="text-xs text-muted-foreground">
                              {isSold && item.sold_gross_amount ? 'Profit' : 'Est. Profit'}
                            </p>
                            <div className="flex items-center justify-end gap-1">
                              {profit >= 0 ? (
                                <TrendingUp className="h-3 w-3 text-green-600" />
                              ) : (
                                <TrendingDown className="h-3 w-3 text-red-600" />
                              )}
                              <span
                                className={cn(
                                  'font-medium',
                                  profit >= 0 ? 'text-green-600' : 'text-red-600'
                                )}
                              >
                                {formatCurrency(profit)}
                              </span>
                            </div>
                            {margin !== null && margin !== undefined && (
                              <p
                                className={cn(
                                  'text-xs',
                                  margin >= 0 ? 'text-green-600' : 'text-red-600'
                                )}
                              >
                                {margin >= 0 ? '+' : ''}
                                {margin.toFixed(0)}%
                              </p>
                            )}
                          </div>
                        )}

                        {/* Status Badge */}
                        <Badge
                          variant={isSold ? 'default' : hasListing ? 'secondary' : 'outline'}
                          className={cn('min-w-[70px] justify-center', isSold && 'bg-green-600')}
                        >
                          {item.status || 'Unknown'}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground py-4 text-center">
                No inventory items linked to this purchase yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Linked BrickLink Uploads */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Linked BrickLink Uploads
              </CardTitle>
              <CardDescription>Parts uploaded to BrickLink from this purchase</CardDescription>
            </div>
            <Button variant="outline" onClick={() => setShowLinkUploadDialog(true)}>
              <Link2 className="mr-2 h-4 w-4" />
              Link Upload
            </Button>
          </CardHeader>
          <CardContent>
            {uploadsData?.data && uploadsData.data.length > 0 ? (
              <>
                <div className="space-y-2">
                  {uploadsData.data.map((upload) => {
                    const profit = (upload.selling_price ?? 0) - (upload.cost ?? 0);
                    const marginPercent =
                      upload.selling_price > 0 ? (profit / upload.selling_price) * 100 : 0;

                    return (
                      <div
                        key={upload.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/bricklink-uploads/${upload.id}`}
                              className="font-medium hover:underline flex items-center gap-1"
                            >
                              {formatDate(upload.upload_date)}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                            <Badge variant={upload.condition === 'N' ? 'default' : 'secondary'}>
                              {upload.condition === 'N' ? 'New' : 'Used'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {upload.total_quantity.toLocaleString()} parts
                            {upload.lots ? ` \u00b7 ${upload.lots.toLocaleString()} lots` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-4">
                          {/* Selling Price */}
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Value</p>
                            <p className="font-medium text-green-600">
                              {formatCurrency(upload.selling_price)}
                            </p>
                          </div>

                          {/* Cost */}
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Cost</p>
                            <p className="font-medium">
                              {upload.cost ? formatCurrency(upload.cost) : '-'}
                            </p>
                          </div>

                          {/* Profit */}
                          {upload.cost && upload.cost > 0 && (
                            <div className="text-right min-w-[80px]">
                              <p className="text-xs text-muted-foreground">Profit</p>
                              <div className="flex items-center justify-end gap-1">
                                {profit >= 0 ? (
                                  <TrendingUp className="h-3 w-3 text-green-600" />
                                ) : (
                                  <TrendingDown className="h-3 w-3 text-red-600" />
                                )}
                                <span
                                  className={cn(
                                    'font-medium',
                                    profit >= 0 ? 'text-green-600' : 'text-red-600'
                                  )}
                                >
                                  {formatCurrency(profit)}
                                </span>
                              </div>
                              <p
                                className={cn(
                                  'text-xs',
                                  marginPercent >= 0 ? 'text-green-600' : 'text-red-600'
                                )}
                              >
                                {marginPercent >= 0 ? '+' : ''}
                                {marginPercent.toFixed(0)}%
                              </p>
                            </div>
                          )}

                          {/* Unlink Button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setUploadToUnlink(upload.id)}
                            title="Unlink this upload"
                          >
                            <Unlink className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Summary */}
                <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {uploadsData.data.length} upload{uploadsData.data.length !== 1 ? 's' : ''}{' '}
                    &middot;{' '}
                    {uploadsData.data
                      .reduce((sum, u) => sum + u.total_quantity, 0)
                      .toLocaleString()}{' '}
                    parts
                  </span>
                  <span className="font-medium text-foreground">
                    Total Value:{' '}
                    {formatCurrency(uploadsData.data.reduce((sum, u) => sum + u.selling_price, 0))}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground py-4 text-center">
                No BrickLink uploads linked to this purchase yet.
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

      {/* Unlink Upload Confirmation Dialog */}
      <Dialog
        open={!!uploadToUnlink}
        onOpenChange={(open: boolean) => !open && setUploadToUnlink(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Upload</DialogTitle>
            <DialogDescription>
              Are you sure you want to unlink this upload from the purchase? The upload will no
              longer contribute to this purchase&apos;s profitability calculations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadToUnlink(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => uploadToUnlink && handleUnlinkUpload(uploadToUnlink)}
              disabled={updateUploadMutation.isPending}
            >
              {updateUploadMutation.isPending ? 'Unlinking...' : 'Unlink'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Upload Dialog */}
      <LinkUploadDialog
        open={showLinkUploadDialog}
        onOpenChange={setShowLinkUploadDialog}
        onSelect={handleLinkUpload}
        purchaseDate={purchase?.purchase_date}
      />
    </>
  );
}
