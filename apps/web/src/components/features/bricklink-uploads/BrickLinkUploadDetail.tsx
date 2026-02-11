'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Calendar,
  Package,
  Hash,
  Cloud,
  FileText,
  Link2,
  ExternalLink,
  Unlink,
} from 'lucide-react';
import { useBrickLinkUpload, useDeleteBrickLinkUpload, useUpdateBrickLinkUpload } from '@/hooks/use-bricklink-uploads';
import { usePurchase } from '@/hooks';
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
import { LinkPurchaseDialog } from './LinkPurchaseDialog';
import type { LinkedPurchaseData } from './LinkPurchaseDialog';

interface BrickLinkUploadDetailProps {
  id: string;
}

/**
 * Format condition code to display text
 */
function formatCondition(condition: string | null): string {
  if (!condition) return 'Unknown';
  return condition === 'N' ? 'New' : 'Used';
}

export function BrickLinkUploadDetail({ id }: BrickLinkUploadDetailProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);

  const { data: upload, isLoading, error } = useBrickLinkUpload(id);
  const { data: linkedPurchase } = usePurchase(upload?.purchase_id ?? undefined);
  const deleteMutation = useDeleteBrickLinkUpload();
  const updateMutation = useUpdateBrickLinkUpload();

  const handleUnlink = async () => {
    await updateMutation.mutateAsync({ id, data: { purchase_id: null, cost: null, source: null } });
    setShowUnlinkDialog(false);
  };

  const handleLinkPurchase = async (purchase: LinkedPurchaseData) => {
    await updateMutation.mutateAsync({
      id,
      data: {
        purchase_id: purchase.id,
        cost: purchase.cost,
        source: purchase.source,
      },
    });
    setShowLinkDialog(false);
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/bricklink-uploads');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">Loading upload...</div>
      </div>
    );
  }

  if (error || !upload) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load upload: {error?.message || 'Not found'}</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/bricklink-uploads">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Uploads
          </Link>
        </Button>
      </div>
    );
  }

  // Calculate profit and profit margin (as % of selling price)
  const profit = upload.cost ? upload.selling_price - upload.cost : 0;
  const profitMargin = upload.selling_price > 0 && upload.cost
    ? ((profit / upload.selling_price) * 100).toFixed(1)
    : '0';

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/bricklink-uploads">
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Back
                </Link>
              </Button>
            </div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              Upload - {formatDate(upload.upload_date)}
              {upload.synced_from_bricqer && (
                <span title="Synced from Bricqer">
                  <Cloud className="h-5 w-5 text-muted-foreground" />
                </span>
              )}
            </h1>
            <p className="text-muted-foreground">
              {upload.total_quantity.toLocaleString()} parts &middot; {formatCurrency(upload.selling_price)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/bricklink-uploads/${id}/edit`}>
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

        <div className="grid gap-6 md:grid-cols-2">
          {/* Upload Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Upload Details
              </CardTitle>
              <CardDescription>Core information about this upload batch</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">Date</span>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {formatDate(upload.upload_date)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Condition</span>
                  <p>
                    <Badge variant={upload.condition === 'N' ? 'default' : 'secondary'}>
                      {formatCondition(upload.condition)}
                    </Badge>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">Parts</span>
                  <p className="font-mono text-lg font-semibold">
                    {upload.total_quantity.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Lots</span>
                  <p className="font-mono text-lg font-semibold">
                    {upload.lots?.toLocaleString() ?? '-'}
                  </p>
                </div>
              </div>

              {upload.source && (
                <div>
                  <span className="text-sm text-muted-foreground">Source</span>
                  <p>
                    <Badge variant="outline">{upload.source}</Badge>
                  </p>
                </div>
              )}

              {upload.reference && (
                <div>
                  <span className="text-sm text-muted-foreground">Reference</span>
                  <p className="font-mono text-sm">{upload.reference}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Financial Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5" />
                Financial Details
              </CardTitle>
              <CardDescription>Pricing and margin information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">Selling Price (Value)</span>
                  <p className="text-lg font-semibold text-green-600">
                    {formatCurrency(upload.selling_price)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Cost</span>
                  <p className="text-lg font-semibold">
                    {upload.cost ? formatCurrency(upload.cost) : '-'}
                  </p>
                </div>
              </div>

              {upload.cost && upload.cost > 0 && (
                <div className="rounded-lg border bg-muted/50 p-4">
                  <span className="text-sm text-muted-foreground">Margin</span>
                  <p className={`text-xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {profit >= 0 ? '+' : ''}{formatCurrency(profit)} ({profitMargin}%)
                  </p>
                </div>
              )}

              {(upload.remaining_quantity !== null && upload.remaining_quantity > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Remaining Qty</span>
                    <p className="font-mono">{upload.remaining_quantity?.toLocaleString() ?? '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Remaining Value</span>
                    <p>{upload.remaining_price ? formatCurrency(upload.remaining_price) : '-'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linked Purchase Card */}
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5" />
                  Linked Purchase
                </CardTitle>
                <CardDescription>
                  {upload.purchase_id
                    ? 'This upload is linked to a purchase'
                    : 'Link this upload to a purchase for profitability tracking'}
                </CardDescription>
              </div>
              {upload.purchase_id ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUnlinkDialog(true)}
                >
                  <Unlink className="mr-2 h-4 w-4" />
                  Unlink
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowLinkDialog(true)}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Link to Purchase
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {linkedPurchase ? (
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Link
                      href={`/purchases/${linkedPurchase.id}`}
                      className="font-medium hover:underline flex items-center gap-2"
                    >
                      {linkedPurchase.short_description}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(linkedPurchase.purchase_date)} &middot;{' '}
                      {formatCurrency(linkedPurchase.cost)}
                      {linkedPurchase.source && (
                        <> &middot; <Badge variant="outline" className="ml-1">{linkedPurchase.source}</Badge></>
                      )}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/purchases/${linkedPurchase.id}`}>
                      View Purchase
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground py-4 text-center">
                  No purchase linked. Click &quot;Link to Purchase&quot; to associate this upload with a purchase.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Notes Card */}
          {upload.notes && (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{upload.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Sync Info Card (if synced from Bricqer) */}
          {upload.synced_from_bricqer && (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cloud className="h-5 w-5" />
                  Bricqer Sync Info
                </CardTitle>
                <CardDescription>This record was synced from Bricqer</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Bricqer Batch ID</span>
                    <p className="font-mono">{upload.bricqer_batch_id ?? '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Bricqer Purchase ID</span>
                    <p className="font-mono">{upload.bricqer_purchase_id ?? '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Activated</span>
                    <p>
                      <Badge variant={upload.is_activated ? 'default' : 'secondary'}>
                        {upload.is_activated ? 'Yes' : 'No'}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Last Updated</span>
                    <p className="text-sm">{formatDate(upload.updated_at)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Upload</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this upload? This action cannot be undone.
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

      {/* Unlink Confirmation Dialog */}
      <Dialog open={showUnlinkDialog} onOpenChange={setShowUnlinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Purchase</DialogTitle>
            <DialogDescription>
              Are you sure you want to unlink this upload from the purchase? The upload will no longer contribute to the purchase&apos;s profitability calculations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnlinkDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleUnlink}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Unlinking...' : 'Unlink'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Purchase Dialog */}
      <LinkPurchaseDialog
        open={showLinkDialog}
        onOpenChange={setShowLinkDialog}
        onSelect={handleLinkPurchase}
        uploadDate={upload?.upload_date}
      />
    </>
  );
}
