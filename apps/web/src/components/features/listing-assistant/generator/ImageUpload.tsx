'use client';

import { useCallback, useState } from 'react';
import { ImageIcon, X, Plus, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  fileToBase64,
  resizeImage,
  validateImageFile,
  validateImageDimensions,
} from '@/lib/listing-assistant/image-processing';
import { EBAY_IMAGE_SPECS } from '@/lib/listing-assistant/constants';

export interface UploadedImage {
  id: string;
  base64: string;
  name: string;
  /** Warning messages for this image (e.g., low resolution) */
  warnings?: string[];
}

interface ImageUploadProps {
  /** Array of uploaded images */
  value: UploadedImage[];
  /** Callback when images change */
  onChange: (images: UploadedImage[]) => void;
  /** Maximum number of images allowed (default: eBay max of 24) */
  maxImages?: number;
  className?: string;
}

export function ImageUpload({
  value,
  onChange,
  maxImages = EBAY_IMAGE_SPECS.maxPhotos,
  className,
}: ImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { toast } = useToast();

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files).filter((f) =>
        f.type.startsWith('image/')
      );

      if (fileArray.length === 0) return;

      // Limit total images
      const remainingSlots = maxImages - value.length;
      if (remainingSlots <= 0) {
        toast({
          title: 'Maximum images reached',
          description: `You can only upload up to ${maxImages} images per listing.`,
          variant: 'destructive',
        });
        return;
      }

      const filesToProcess = fileArray.slice(0, remainingSlots);
      setIsProcessing(true);

      const newImages: UploadedImage[] = [];
      const errors: string[] = [];

      for (const file of filesToProcess) {
        // Validate file
        const fileValidation = validateImageFile(file);
        if (!fileValidation.valid) {
          errors.push(`${file.name}: ${fileValidation.errors.join(', ')}`);
          continue;
        }

        try {
          let base64 = await fileToBase64(file);

          // Validate dimensions
          const dimValidation = await validateImageDimensions(base64);
          if (!dimValidation.valid) {
            errors.push(`${file.name}: ${dimValidation.errors.join(', ')}`);
            continue;
          }

          // Resize to eBay recommended dimension (1600px)
          base64 = await resizeImage(base64, EBAY_IMAGE_SPECS.recommendedDimension);

          newImages.push({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            base64,
            name: file.name,
            warnings: dimValidation.warnings,
          });
        } catch (error) {
          console.error('Failed to load image:', file.name, error);
          errors.push(`${file.name}: Failed to process image`);
        }
      }

      setIsProcessing(false);

      // Show errors if any
      if (errors.length > 0) {
        toast({
          title: 'Some images could not be added',
          description: errors.slice(0, 3).join('\n') + (errors.length > 3 ? `\n...and ${errors.length - 3} more` : ''),
          variant: 'destructive',
        });
      }

      if (newImages.length > 0) {
        onChange([...value, ...newImages]);

        // Show warning for low-res images
        const warningImages = newImages.filter((img) => img.warnings && img.warnings.length > 0);
        if (warningImages.length > 0) {
          toast({
            title: 'Image quality notice',
            description: `${warningImages.length} image(s) are below the recommended size for eBay zoom feature.`,
          });
        }
      }
    },
    [value, onChange, maxImages, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    if (isProcessing) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
    };
    input.click();
  }, [handleFiles, isProcessing]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(value.filter((img) => img.id !== id));
    },
    [value, onChange]
  );

  const canAddMore = value.length < maxImages;

  // Lightbox navigation
  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const goToPrevious = useCallback(() => {
    if (lightboxIndex !== null && lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
    }
  }, [lightboxIndex]);

  const goToNext = useCallback(() => {
    if (lightboxIndex !== null && lightboxIndex < value.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
    }
  }, [lightboxIndex, value.length]);

  // Show grid view if we have images
  if (value.length > 0) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="grid grid-cols-4 gap-2">
          {value.map((image, index) => (
            <div
              key={image.id}
              className="relative group aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              <button
                type="button"
                onClick={() => openLightbox(index)}
                className="w-full h-full cursor-zoom-in"
              >
                <img
                  src={image.base64}
                  alt={image.name}
                  className="h-full w-full object-cover"
                />
              </button>
              {/* Warning indicator for low-res images */}
              {image.warnings && image.warnings.length > 0 && (
                <div
                  className="absolute bottom-1 left-1 bg-yellow-500 text-white p-1 rounded"
                  title={image.warnings.join('\n')}
                >
                  <AlertTriangle className="h-3 w-3" />
                </div>
              )}
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(image.id);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {/* Add more button */}
          {canAddMore && (
            <button
              type="button"
              onClick={handleClick}
              disabled={isProcessing}
              className={cn(
                'aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors',
                'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
                isProcessing && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Plus className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {isProcessing ? 'Adding...' : 'Add'}
              </span>
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {value.length} of {maxImages} images (eBay allows up to {EBAY_IMAGE_SPECS.maxPhotos})
        </p>

        {/* Lightbox Modal */}
        <Dialog open={lightboxIndex !== null} onOpenChange={(open: boolean) => !open && closeLightbox()}>
          <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden bg-black/95 border-none">
            {lightboxIndex !== null && value[lightboxIndex] && (
              <div className="relative flex items-center justify-center min-h-[400px]">
                {/* Close button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
                  onClick={closeLightbox}
                >
                  <X className="h-5 w-5" />
                </Button>

                {/* Previous button */}
                {lightboxIndex > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 text-white hover:bg-white/20 h-12 w-12"
                    onClick={goToPrevious}
                  >
                    <ChevronLeft className="h-8 w-8" />
                  </Button>
                )}

                {/* Image */}
                <img
                  src={value[lightboxIndex].base64}
                  alt={value[lightboxIndex].name}
                  className="max-w-full max-h-[85vh] object-contain"
                />

                {/* Next button */}
                {lightboxIndex < value.length - 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-white hover:bg-white/20 h-12 w-12"
                    onClick={goToNext}
                  >
                    <ChevronRight className="h-8 w-8" />
                  </Button>
                )}

                {/* Image info footer */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-3 flex items-center justify-between">
                  <span className="text-sm truncate max-w-[70%]">
                    {value[lightboxIndex].name}
                  </span>
                  <span className="text-sm text-white/70">
                    {lightboxIndex + 1} of {value.length}
                  </span>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Empty state - show dropzone
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
        isProcessing
          ? 'border-muted-foreground/25 cursor-wait'
          : isDragging
            ? 'border-primary bg-primary/5 cursor-pointer'
            : 'border-muted-foreground/25 hover:border-primary/50 cursor-pointer',
        className
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
    >
      <ImageIcon className="h-10 w-10 text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground text-center">
        {isProcessing ? (
          'Processing images...'
        ) : (
          <>
            <span className="font-medium text-foreground">Click to upload</span>
            {' '}or drag and drop
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        JPEG, PNG or WebP • Min {EBAY_IMAGE_SPECS.minDimension}×{EBAY_IMAGE_SPECS.minDimension}px • Max {EBAY_IMAGE_SPECS.maxFileSizeMB}MB each
      </p>
      <p className="text-xs text-muted-foreground">
        Recommended: {EBAY_IMAGE_SPECS.recommendedDimension}×{EBAY_IMAGE_SPECS.recommendedDimension}px for zoom • Up to {maxImages} images
      </p>
    </div>
  );
}
