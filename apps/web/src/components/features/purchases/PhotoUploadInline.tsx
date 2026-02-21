'use client';

import { useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import { Camera, Upload, X, ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { compressImage } from '@/lib/utils/image-compression';

/**
 * Pending image to be uploaded after purchase creation
 */
export interface PendingImage {
  id: string;
  file: File;
  preview: string;
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  filename: string;
}

interface PhotoUploadInlineProps {
  pendingImages: PendingImage[];
  onImagesChange: (images: PendingImage[]) => void;
  maxImages?: number;
}

/**
 * Inline photo upload for use in PurchaseForm
 * Collects images to be uploaded after purchase creation
 */
export function PhotoUploadInline({
  pendingImages,
  onImagesChange,
  maxImages = 10,
}: PhotoUploadInlineProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setIsProcessing(true);

      const newImages: PendingImage[] = [];

      for (let i = 0; i < files.length; i++) {
        // Check max limit
        if (pendingImages.length + newImages.length >= maxImages) {
          break;
        }

        const file = files[i];

        // Validate file type
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
          continue;
        }

        const id = `pending-${Date.now()}-${i}`;
        const preview = URL.createObjectURL(file);

        try {
          // Compress image before storing (max 1600px, 80% quality)
          const compressed = await compressImage(file, {
            maxDimension: 1600,
            quality: 0.8,
            outputType: 'image/jpeg',
          });

          newImages.push({
            id,
            file,
            preview,
            base64: compressed.base64,
            mimeType: compressed.mimeType,
            filename: file.name,
          });
        } catch {
          // Fallback to original if compression fails
          try {
            const base64 = await fileToBase64(file);
            newImages.push({
              id,
              file,
              preview,
              base64,
              mimeType: file.type as PendingImage['mimeType'],
              filename: file.name,
            });
          } catch {
            // Clean up preview if both fail
            URL.revokeObjectURL(preview);
          }
        }
      }

      if (newImages.length > 0) {
        onImagesChange([...pendingImages, ...newImages]);
      }

      setIsProcessing(false);

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [pendingImages, onImagesChange, maxImages]
  );

  const handleRemove = useCallback(
    (imageId: string) => {
      const imageToRemove = pendingImages.find((img) => img.id === imageId);
      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.preview);
      }
      onImagesChange(pendingImages.filter((img) => img.id !== imageId));
    },
    [pendingImages, onImagesChange]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0 && fileInputRef.current) {
      const dt = new DataTransfer();
      for (let i = 0; i < files.length; i++) {
        dt.items.add(files[i]);
      }
      fileInputRef.current.files = dt.files;
      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  const hasImages = pendingImages.length > 0;
  const canAddMore = pendingImages.length < maxImages;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Photos &amp; Receipts
          </CardTitle>
          <CardDescription>
            Attach photos of receipts and items for tracking and tax purposes
          </CardDescription>
        </div>
        {canAddMore && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              disabled={isProcessing}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Add Photos
                </>
              )}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {hasImages ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {pendingImages.map((image) => (
              <div
                key={image.id}
                className="group relative aspect-square rounded-lg overflow-hidden border bg-muted"
              >
                <Image
                  src={image.preview}
                  alt={image.filename}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"
                />
                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => handleRemove(image.id)}
                  className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-black/80 rounded-full text-white transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
                {/* Filename */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] p-1 truncate">
                  {image.filename}
                </div>
              </div>
            ))}

            {/* Add more button inline */}
            {canAddMore && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Upload className="h-5 w-5 mb-1" />
                <span className="text-[10px]">Add</span>
              </button>
            )}
          </div>
        ) : (
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors"
          >
            <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Drag and drop photos here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              JPEG, PNG, WebP, GIF (auto-compressed, up to {maxImages} images)
            </p>
          </div>
        )}

        {pendingImages.length > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            {pendingImages.length} photo{pendingImages.length !== 1 ? 's' : ''} will be uploaded
            when you save
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Convert File to base64 string
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
