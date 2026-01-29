'use client';

import { useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  Camera,
  Upload,
  Trash2,
  ImageIcon,
  Loader2,
  ZoomIn,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  usePurchaseImages,
  useUploadPurchaseImages,
  useDeletePurchaseImage,
} from '@/hooks/use-purchase-images';
import type { PurchaseImage } from '@/lib/services/purchase-image.service';
import { compressImage } from '@/lib/utils/image-compression';

interface PurchaseImagesProps {
  purchaseId: string;
  readOnly?: boolean;
}

interface UploadingImage {
  id: string;
  preview: string;
  filename: string;
}

/**
 * Purchase Images Component
 *
 * Displays images attached to a purchase with upload/delete capabilities.
 */
export function PurchaseImages({ purchaseId, readOnly = false }: PurchaseImagesProps) {
  const [uploadingImages, setUploadingImages] = useState<UploadingImage[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<PurchaseImage | null>(null);
  const [previewImage, setPreviewImage] = useState<PurchaseImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: images, isLoading } = usePurchaseImages(purchaseId);
  const uploadMutation = useUploadPurchaseImages(purchaseId);
  const deleteMutation = useDeletePurchaseImage(purchaseId);

  // Handle file selection
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filesToUpload: Array<{
      id: string;
      base64: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      filename: string;
    }> = [];

    const previews: UploadingImage[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!validTypes.includes(file.type)) {
        continue;
      }

      // Generate ID and preview
      const id = `upload-${Date.now()}-${i}`;
      const preview = URL.createObjectURL(file);
      previews.push({ id, preview, filename: file.name });

      try {
        // Compress image before upload (max 1600px, 80% quality)
        const compressed = await compressImage(file, {
          maxDimension: 1600,
          quality: 0.8,
          outputType: 'image/jpeg',
        });

        filesToUpload.push({
          id,
          base64: compressed.base64,
          mimeType: compressed.mimeType,
          filename: file.name,
        });
      } catch {
        // Fallback to original file if compression fails
        const base64 = await fileToBase64(file);
        filesToUpload.push({
          id,
          base64,
          mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          filename: file.name,
        });
      }
    }

    if (filesToUpload.length === 0) return;

    // Show previews while uploading
    setUploadingImages(previews);

    try {
      await uploadMutation.mutateAsync(filesToUpload);
    } finally {
      // Cleanup previews
      previews.forEach((p) => URL.revokeObjectURL(p.preview));
      setUploadingImages([]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [uploadMutation]);

  // Handle delete confirmation
  const handleDeleteClick = (image: PurchaseImage) => {
    setImageToDelete(image);
    setDeleteDialogOpen(true);
  };

  // Perform delete
  const handleDeleteConfirm = async () => {
    if (!imageToDelete) return;

    await deleteMutation.mutateAsync(imageToDelete.id);
    setDeleteDialogOpen(false);
    setImageToDelete(null);
  };

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0 && fileInputRef.current) {
      // Create a new DataTransfer to set files on input
      const dt = new DataTransfer();
      for (let i = 0; i < files.length; i++) {
        dt.items.add(files[i]);
      }
      fileInputRef.current.files = dt.files;
      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  const allImages = [...(images || [])];
  const hasImages = allImages.length > 0 || uploadingImages.length > 0;

  return (
    <>
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
          {!readOnly && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                disabled={uploadMutation.isPending}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Photos
                  </>
                )}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : hasImages ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {/* Existing images */}
              {allImages.map((image) => (
                <div
                  key={image.id}
                  className="group relative aspect-square rounded-lg overflow-hidden border bg-muted"
                >
                  <Image
                    src={image.public_url}
                    alt={image.filename}
                    fill
                    className="object-cover cursor-pointer"
                    onClick={() => setPreviewImage(image)}
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                  />
                  {/* Overlay with actions */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPreviewImage(image)}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    {!readOnly && (
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDeleteClick(image)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {/* Filename */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">
                    {image.filename}
                  </div>
                </div>
              ))}

              {/* Uploading images (preview) */}
              {uploadingImages.map((img) => (
                <div
                  key={img.id}
                  className="relative aspect-square rounded-lg overflow-hidden border bg-muted"
                >
                  <Image
                    src={img.preview}
                    alt={img.filename}
                    fill
                    className="object-cover opacity-50"
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                </div>
              ))}
            </div>
          ) : !readOnly ? (
            /* Drop zone for new images */
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors"
            >
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Drag and drop photos here, or click to browse
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Supports JPEG, PNG, WebP, GIF (auto-compressed)
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground py-4 text-center">
              No photos attached to this purchase.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Image Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewImage?.filename}</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <div className="relative w-full aspect-video">
              <Image
                src={previewImage.public_url}
                alt={previewImage.filename}
                fill
                className="object-contain"
                sizes="(max-width: 1024px) 100vw, 1024px"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" asChild>
              <a
                href={previewImage?.public_url}
                target="_blank"
                rel="noopener noreferrer"
                download={previewImage?.filename}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
            <Button onClick={() => setPreviewImage(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Photo</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{imageToDelete?.filename}&quot;? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Convert File to base64 string
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Return full data URL (includes prefix)
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
