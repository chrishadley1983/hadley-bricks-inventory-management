'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Check,
  X,
  Send,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Pencil,
  Loader2,
} from 'lucide-react';
import type { MinifigSyncItem, SourcedImage } from '@/lib/minifig-sync/types';
import type { SyncItemUpdateData } from '@/lib/api/minifig-sync';
import { ImageGallery } from './ImageGallery';
import { DescriptionEditor } from './DescriptionEditor';
import { AspectEditor } from './AspectEditor';
import { PricingSection } from './PricingSection';
import { EbayFieldsSection } from './EbayFieldsSection';
import { getQualityCheck } from './utils';

interface ListingReviewDetailProps {
  item: MinifigSyncItem;
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  onPublish: (id: string) => void;
  onReject: (id: string) => void;
  onRefreshPricing: (id: string) => void;
  onUpdate: (id: string, data: SyncItemUpdateData) => void;
  isPublishing?: boolean;
  isRejecting?: boolean;
  isRefreshing?: boolean;
  isUpdating?: boolean;
}

export function ListingReviewDetail({
  item,
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  onPublish,
  onReject,
  onRefreshPricing,
  onUpdate,
  isPublishing,
  isRejecting,
  isRefreshing,
  isUpdating,
}: ListingReviewDetailProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  const images = (item.images as SourcedImage[] | null) ?? [];
  const aspects = (item.ebay_aspects as Record<string, string[]> | null) ?? {};
  const quality = getQualityCheck(item);
  const isActioning = isPublishing || isRejecting || isRefreshing;
  const displayTitle =
    item.ebay_title || `LEGO ${item.name || item.bricklink_id} Minifigure - Used`;

  const handleSaveTitle = () => {
    if (editTitle.trim()) {
      onUpdate(item.id, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  return (
    <div className="space-y-4">
      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[55%_45%] gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Title */}
          <div>
            {isEditingTitle ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTitle();
                      if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    className="text-lg font-semibold"
                    autoFocus
                    maxLength={80}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={handleSaveTitle}
                  >
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setIsEditingTitle(false)}
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  {editTitle.length}/80 characters
                </p>
              </div>
            ) : (
              <div
                className="group flex items-center gap-2 cursor-pointer"
                onClick={() => {
                  setEditTitle(displayTitle);
                  setIsEditingTitle(true);
                }}
              >
                <h2 className="text-lg font-semibold leading-tight">{displayTitle}</h2>
                <Pencil className="h-4 w-4 opacity-0 group-hover:opacity-50 shrink-0" />
              </div>
            )}
          </div>

          {/* Image Gallery */}
          <ImageGallery
            images={images}
            itemName={item.name || item.bricklink_id || 'Minifig'}
            itemId={item.id}
            onImagesChange={(newImages) => onUpdate(item.id, { images: newImages })}
            isUpdating={isUpdating}
          />

          {/* Description */}
          <DescriptionEditor
            value={item.ebay_description || ''}
            onSave={(description) => onUpdate(item.id, { description })}
            isUpdating={isUpdating}
            label="Description"
            richText
          />

          {/* Condition Description */}
          <DescriptionEditor
            value={item.ebay_condition_description || ''}
            onSave={(conditionDescription) => onUpdate(item.id, { conditionDescription })}
            isUpdating={isUpdating}
            label="Condition Description"
            richText={false}
          />
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {item.bricklink_id}
            </Badge>
            {item.ebay_sku && (
              <Badge variant="secondary" className="text-xs">
                SKU: {item.ebay_sku}
              </Badge>
            )}
            {item.ebay_offer_id && (
              <Badge variant="secondary" className="text-xs">
                Offer: {item.ebay_offer_id}
              </Badge>
            )}
          </div>

          {/* Pricing */}
          <PricingSection
            item={item}
            onUpdate={(data) => onUpdate(item.id, data)}
            isUpdating={isUpdating}
          />

          <Separator />

          {/* Item Specifics */}
          <AspectEditor
            aspects={aspects}
            onSave={(newAspects) => onUpdate(item.id, { aspects: newAspects })}
            isUpdating={isUpdating}
          />

          <Separator />

          {/* eBay Fields */}
          <EbayFieldsSection
            condition={item.ebay_condition}
            categoryId={item.ebay_category_id}
            onConditionChange={(condition) => onUpdate(item.id, { condition })}
            onCategoryIdChange={(categoryId) => onUpdate(item.id, { categoryId })}
            isUpdating={isUpdating}
          />

          {/* Quality Warnings */}
          {!quality.passed && (
            <>
              <Separator />
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <p className="text-sm font-medium text-amber-800">Quality Issues</p>
                </div>
                <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                  {quality.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 bg-background border-t pt-4 pb-2 flex items-center justify-between gap-4">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPrev} disabled={currentIndex === 0}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {currentIndex + 1} of {totalCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRefreshPricing(item.id)}
            disabled={isActioning}
            title="Refresh pricing data"
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isActioning}>
                {isRejecting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Reject
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reject this listing?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete the eBay inventory item and offer for &quot;{item.name}&quot; and
                  reset it to NOT_LISTED.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onReject(item.id)}>Reject</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            size="sm"
            disabled={isActioning || !quality.passed}
            onClick={() => onPublish(item.id)}
          >
            {isPublishing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1" />
            )}
            Publish
          </Button>
        </div>
      </div>
    </div>
  );
}
