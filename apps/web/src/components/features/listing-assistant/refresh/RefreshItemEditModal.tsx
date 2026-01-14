'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { RefreshJobItem } from '@/lib/ebay/listing-refresh.types';

interface RefreshItemEditModalProps {
  item: RefreshJobItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (itemId: string, updates: { title?: string; price?: number; quantity?: number }) => Promise<void>;
  onApprove: (itemId: string) => Promise<void>;
  onSkip: (itemId: string) => Promise<void>;
  isSaving?: boolean;
}

/**
 * Modal for reviewing and editing a listing before refresh
 */
export function RefreshItemEditModal({
  item,
  open,
  onOpenChange,
  onSave,
  onApprove,
  onSkip,
  isSaving = false,
}: RefreshItemEditModalProps) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Reset form when item changes
  useEffect(() => {
    if (item) {
      setTitle(item.modifiedTitle || item.originalTitle);
      setPrice(String(item.modifiedPrice ?? item.originalPrice ?? ''));
      setQuantity(String(item.modifiedQuantity ?? item.originalQuantity ?? ''));
      setHasChanges(false);
    }
  }, [item]);

  // Track changes
  useEffect(() => {
    if (!item) return;
    const originalTitle = item.modifiedTitle || item.originalTitle;
    const originalPrice = String(item.modifiedPrice ?? item.originalPrice ?? '');
    const originalQty = String(item.modifiedQuantity ?? item.originalQuantity ?? '');

    setHasChanges(
      title !== originalTitle || price !== originalPrice || quantity !== originalQty
    );
  }, [title, price, quantity, item]);

  const handleSaveAndApprove = async () => {
    if (!item) return;

    // Save changes if any
    if (hasChanges) {
      const updates: { title?: string; price?: number; quantity?: number } = {};
      if (title !== item.originalTitle) updates.title = title;
      if (price !== String(item.originalPrice)) updates.price = parseFloat(price);
      if (quantity !== String(item.originalQuantity)) updates.quantity = parseInt(quantity, 10);

      if (Object.keys(updates).length > 0) {
        await onSave(item.id, updates);
      }
    }

    // Approve the item
    await onApprove(item.id);
    onOpenChange(false);
  };

  const handleSkip = async () => {
    if (!item) return;
    await onSkip(item.id);
    onOpenChange(false);
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review Listing</DialogTitle>
          <DialogDescription>
            Review and optionally edit the listing details before refreshing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Original Listing Info */}
          <div className="flex gap-4">
            {item.originalGalleryUrl && (
              <img
                src={item.originalGalleryUrl}
                alt={item.originalTitle}
                className="w-24 h-24 object-cover rounded"
              />
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{item.originalCondition || 'Unknown'}</Badge>
                {item.originalCategoryName && (
                  <span className="text-sm text-muted-foreground">
                    {item.originalCategoryName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Item ID: {item.originalItemId}</span>
                {item.originalSku && <span>SKU: {item.originalSku}</span>}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span>Watchers: {item.originalWatchers}</span>
                {item.originalViews !== null && <span>Views: {item.originalViews}</span>}
                <span>Sold: {item.originalQuantitySold}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Editable Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                {title.length}/80 characters
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Price</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    £
                  </span>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="pl-7"
                    disabled={isSaving}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={isSaving}
                />
              </div>
            </div>
          </div>

          {hasChanges && (
            <p className="text-sm text-amber-500">
              You have unsaved changes that will be applied when you approve.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={isSaving}
          >
            Skip This Listing
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSaveAndApprove} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {hasChanges ? 'Save & Approve' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
