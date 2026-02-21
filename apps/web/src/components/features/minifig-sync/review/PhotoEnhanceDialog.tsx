'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Upload, ClipboardPaste, Sparkles } from 'lucide-react';
import { enhanceMinifigPhoto, type EnhanceProgress } from '@/lib/utils/background-removal';
import { compressImage } from '@/lib/utils/image-compression';
import type { SourcedImage } from '@/lib/minifig-sync/types';

interface PhotoEnhanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  onEnhanced: (image: SourcedImage) => void;
}

type Step = 'input' | 'processing' | 'preview';

export function PhotoEnhanceDialog({
  open,
  onOpenChange,
  itemId,
  onEnhanced,
}: PhotoEnhanceDialogProps) {
  const [step, setStep] = useState<Step>('input');
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [resultPreview, setResultPreview] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [progressMsg, setProgressMsg] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog closes — revoke object URLs to prevent leaks
  useEffect(() => {
    if (!open) {
      setStep('input');
      setSourcePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setResultPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setResultBlob(null);
      setProgressMsg('');
      setError(null);
      setIsUploading(false);
    }
  }, [open]);

  // Clipboard paste handler
  useEffect(() => {
    if (!open || step !== 'input') return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) processFile(file);
          return;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const processFile = useCallback(async (file: File) => {
    setError(null);

    // Show source preview
    const srcUrl = URL.createObjectURL(file);
    setSourcePreview(srcUrl);
    setStep('processing');
    setProgressMsg('Removing background...');

    try {
      const enhanced = await enhanceMinifigPhoto(file, (p: EnhanceProgress) => {
        if (p.stage === 'removing-background') {
          const pct = p.progress ? Math.round(p.progress * 100) : 0;
          setProgressMsg(`Removing background... ${pct}%`);
        } else {
          setProgressMsg('Adding wood background...');
        }
      });

      const resultUrl = URL.createObjectURL(enhanced);
      setResultPreview(resultUrl);
      setResultBlob(enhanced);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed');
      setStep('input');
      URL.revokeObjectURL(srcUrl);
      setSourcePreview(null);
    }
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && file.type.startsWith('image/')) {
        processFile(file);
      }
      e.target.value = '';
    },
    [processFile]
  );

  const handlePasteButton = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const file = new File([blob], `pasted-${Date.now()}.png`, { type });
            processFile(file);
            return;
          }
        }
      }
      setError('No image found in clipboard');
    } catch {
      setError('Could not read clipboard. Try Ctrl+V instead.');
    }
  }, [processFile]);

  const handleAddToListing = useCallback(async () => {
    if (!resultBlob) return;

    setIsUploading(true);
    try {
      // Compress for upload
      const file = new File([resultBlob], `enhanced-${Date.now()}.jpg`, {
        type: 'image/jpeg',
      });
      const compressed = await compressImage(file, {
        maxDimension: 1600,
        quality: 0.8,
        outputType: 'image/jpeg',
      });

      // Upload via eBay upload endpoint
      const imageId = `enhanced-${Date.now()}`;
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

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      const result = data.results?.find(
        (r: { id: string; success: boolean; url?: string }) => r.id === imageId
      );

      if (result?.success && result.url) {
        onEnhanced({
          url: result.url,
          source: 'enhanced',
          type: 'original',
        });
        onOpenChange(false);
      } else {
        throw new Error('Upload succeeded but no URL returned');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [resultBlob, itemId, onEnhanced, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Enhance Photo
          </DialogTitle>
          <DialogDescription>
            Remove the background and add a wood surface backdrop.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === 'input' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground text-center">
              Paste a screenshot or upload a photo. The background will be removed
              and replaced with a wood surface.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={handlePasteButton}>
                <ClipboardPaste className="h-4 w-4 mr-2" />
                Paste from Clipboard
              </Button>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              or press <kbd className="px-1.5 py-0.5 rounded bg-muted border text-xs">Ctrl+V</kbd> to paste
            </p>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{progressMsg}</p>
            {sourcePreview && (
              <div className="w-48 h-48 rounded-lg overflow-hidden border bg-muted">
                <Image
                  src={sourcePreview}
                  alt="Source"
                  width={192}
                  height={192}
                  className="w-full h-full object-contain"
                  unoptimized
                />
              </div>
            )}
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground text-center">Before</p>
                <div className="aspect-square rounded-lg overflow-hidden border bg-muted">
                  {sourcePreview && (
                    <Image
                      src={sourcePreview}
                      alt="Original"
                      width={400}
                      height={400}
                      className="w-full h-full object-contain"
                      unoptimized
                    />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground text-center">After</p>
                <div className="aspect-square rounded-lg overflow-hidden border bg-muted">
                  {resultPreview && (
                    <Image
                      src={resultPreview}
                      alt="Enhanced"
                      width={400}
                      height={400}
                      className="w-full h-full object-contain"
                      unoptimized
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (sourcePreview) URL.revokeObjectURL(sourcePreview);
                if (resultPreview) URL.revokeObjectURL(resultPreview);
                setStep('input');
                setSourcePreview(null);
                setResultPreview(null);
                setResultBlob(null);
              }}
            >
              Try Another
            </Button>
            <Button onClick={handleAddToListing} disabled={isUploading}>
              {isUploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Add to Listing
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
