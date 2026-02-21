'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Upload, X, Loader2, ZoomIn } from 'lucide-react';
import { compressImage } from '@/lib/utils/image-compression';
import type { SourcedImage } from '@/lib/minifig-sync/types';

interface ImageGalleryProps {
  images: SourcedImage[];
  itemName: string;
  itemId: string;
  onImagesChange: (images: SourcedImage[]) => void;
  isUpdating?: boolean;
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'google':
      return 'Google';
    case 'brave':
      return 'Brave';
    case 'rebrickable':
      return 'Rebrickable';
    case 'bricklink':
      return 'BrickLink';
    case 'bricqer':
      return 'Bricqer';
    case 'uploaded':
      return 'Uploaded';
    default:
      return source;
  }
}

function getSourceBadgeVariant(source: string): 'default' | 'secondary' | 'outline' {
  switch (source) {
    case 'google':
    case 'brave':
      return 'default';
    case 'rebrickable':
      return 'secondary';
    case 'uploaded':
      return 'secondary';
    default:
      return 'outline';
  }
}

export function ImageGallery({
  images,
  itemName,
  itemId,
  onImagesChange,
  isUpdating,
}: ImageGalleryProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleDelete = useCallback(
    (index: number) => {
      const updated = images.filter((_, i) => i !== index);
      onImagesChange(updated);
    },
    [images, onImagesChange]
  );

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      setIsUploading(true);
      try {
        const newImages: SourcedImage[] = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file.type.startsWith('image/')) continue;

          const compressed = await compressImage(file, {
            maxDimension: 1600,
            quality: 0.8,
            outputType: 'image/jpeg',
          });

          // Upload to Supabase Storage via API
          const imageId = `${Date.now()}-${i}`;
          const response = await fetch('/api/ebay/upload-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              images: [
                {
                  id: imageId,
                  filename: file.name,
                  base64: compressed.base64,
                  mimeType: compressed.mimeType,
                },
              ],
              inventoryItemId: itemId,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const result = data.results?.find(
              (r: { id: string; success: boolean; url?: string }) => r.id === imageId
            );
            if (result?.success && result.url) {
              newImages.push({
                url: result.url,
                source: 'uploaded',
                type: 'original',
              });
            }
          }
        }

        if (newImages.length > 0) {
          onImagesChange([...images, ...newImages]);
        }
      } finally {
        setIsUploading(false);
        // Reset input
        event.target.value = '';
      }
    },
    [images, itemId, onImagesChange]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Images ({images.length})</span>
        <label
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer hover:bg-muted transition-colors ${
            isUploading ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          {isUploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Upload
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={isUploading || isUpdating}
          />
        </label>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {images.map((img, i) => (
          <div key={`${img.url}-${i}`} className="relative group">
            <div
              className="aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer"
              onClick={() => setLightboxUrl(img.url)}
            >
              <Image
                src={img.url}
                alt={`${itemName} - image ${i + 1}`}
                width={200}
                height={200}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                unoptimized
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-md" />
              </div>
            </div>
            <Badge
              variant={getSourceBadgeVariant(img.source)}
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] px-1.5 py-0"
            >
              {getSourceLabel(img.source)}
            </Badge>
            <button
              type="button"
              className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(i);
              }}
              disabled={isUpdating}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {images.length === 0 && (
          <div className="col-span-full flex items-center justify-center rounded-lg border-2 border-dashed p-8 text-sm text-muted-foreground">
            No images yet
          </div>
        )}
      </div>

      {/* Lightbox Dialog */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {lightboxUrl && (
            <Image
              src={lightboxUrl}
              alt={itemName}
              width={1200}
              height={1200}
              className="w-full h-auto rounded-lg object-contain max-h-[80vh]"
              unoptimized
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
