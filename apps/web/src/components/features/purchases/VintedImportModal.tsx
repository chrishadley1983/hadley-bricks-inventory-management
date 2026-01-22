'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  ImageIcon,
  Loader2,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  Package,
  ShoppingCart,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProcessVintedScreenshot, useImportVintedPurchases } from '@/hooks';
import { deriveInventoryStatusFromVinted } from '@/lib/utils';
import { VintedPurchaseReviewRow, type VintedPurchaseReviewData } from './VintedPurchaseReviewRow';
import {
  VintedInventoryReviewCard,
  type InventoryItemReviewData,
} from './VintedInventoryReviewCard';

type Step = 'upload' | 'processing' | 'review-purchases' | 'review-inventory' | 'importing' | 'complete';

interface VintedImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Multi-step modal for importing Vinted purchases
 */
export function VintedImportModal({ open, onOpenChange }: VintedImportModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();

  // State
  const [step, setStep] = useState<Step>('upload');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  } | null>(null);
  const [purchases, setPurchases] = useState<VintedPurchaseReviewData[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemReviewData[]>([]);
  const [importSummary, setImportSummary] = useState<{
    purchases: number;
    inventoryItems: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hooks
  const processScreenshot = useProcessVintedScreenshot();
  const importMutation = useImportVintedPurchases();

  // Monzo sync mutation
  const syncMonzoMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/monzo/sync', {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Monzo sync failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monzo', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  // Reset state when modal closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setStep('upload');
        setImagePreview(null);
        setImageData(null);
        setPurchases([]);
        setInventoryItems([]);
        setImportSummary(null);
        setError(null);
        processScreenshot.reset();
        syncMonzoMutation.reset();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, processScreenshot, syncMonzoMutation]
  );

  // Cleanup blob URL when imagePreview changes or component unmounts
  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  // Process an image file (shared by file select, drag/drop, and paste)
  const processImageFile = useCallback((file: File) => {
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      setError('Please select a valid image file (JPEG, PNG, WebP, or GIF)');
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB');
      return;
    }

    setError(null);

    // Create preview
    const preview = URL.createObjectURL(file);
    setImagePreview(preview);

    // Convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setImageData({
        base64,
        mediaType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
      });
    };
    reader.readAsDataURL(file);
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processImageFile(file);
      }
    },
    [processImageFile]
  );

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const file = e.dataTransfer.files?.[0];
      if (file) {
        processImageFile(file);
      }
    },
    [processImageFile]
  );

  // Handle paste from clipboard
  useEffect(() => {
    if (!open || step !== 'upload') return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processImageFile(file);
            break;
          }
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, step, processImageFile]);

  // Analyze screenshot (with silent Monzo sync first)
  const handleAnalyze = useCallback(async () => {
    if (!imageData) return;

    setError(null);
    setStep('processing');

    // Sync Monzo transactions silently first (don't block on failure)
    try {
      await syncMonzoMutation.mutateAsync();
    } catch (err) {
      // Monzo sync failed, but we can still continue with existing transactions
      console.warn('Monzo sync failed, continuing with existing transactions:', err);
    }

    // Process the screenshot
    try {
      const result = await processScreenshot.process({ image: imageData });

      if (result.purchases.length === 0) {
        setError('No purchases found in the screenshot. Please try a different image.');
        setStep('upload');
        return;
      }

      // Build purchase review data
      const today = new Date().toISOString().split('T')[0];
      const purchaseReviewData: VintedPurchaseReviewData[] = result.purchases.map((p, index) => {
        const monzoMatch = result.matches.find((m) => m.index === index);
        const duplicateCheck = result.duplicates.find((d) => d.index === index);
        const isExactDuplicate = duplicateCheck?.duplicateType === 'exact';

        return {
          ...p,
          index,
          selected: !isExactDuplicate,
          purchaseDate: monzoMatch?.purchaseDate || today,
          monzoMatch,
          duplicateCheck,
        };
      });

      setPurchases(purchaseReviewData);
      setStep('review-purchases');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze screenshot');
      setStep('upload');
    }
  }, [imageData, processScreenshot, syncMonzoMutation]);

  // Handle purchase selection change
  const handlePurchaseSelectionChange = useCallback((index: number, selected: boolean) => {
    setPurchases((prev) =>
      prev.map((p) => (p.index === index ? { ...p, selected } : p))
    );
  }, []);

  // Handle purchase date change
  const handlePurchaseDateChange = useCallback((index: number, date: string) => {
    setPurchases((prev) =>
      prev.map((p) => (p.index === index ? { ...p, purchaseDate: date } : p))
    );
  }, []);

  // Move to inventory review
  const handleNextToInventory = useCallback(() => {
    const selectedPurchases = purchases.filter((p) => p.selected);

    const items: InventoryItemReviewData[] = selectedPurchases.map((p) => ({
      purchaseIndex: p.index,
      purchaseTitle: p.title,
      purchaseCost: p.price,
      purchaseDate: p.purchaseDate, // Use the editable date from the purchase
      vintedStatus: p.status,
      setNumber: p.setNumber || '',
      itemName: '',
      condition: 'New' as const,
      status: deriveInventoryStatusFromVinted(p.status),
      storageLocation: '',
      listingValue: null,
      amazonAsin: '',
      skipCreation: false,
    }));

    setInventoryItems(items);
    setStep('review-inventory');
  }, [purchases]);

  // Handle inventory item change
  const handleInventoryItemChange = useCallback((updated: InventoryItemReviewData) => {
    setInventoryItems((prev) =>
      prev.map((item) =>
        item.purchaseIndex === updated.purchaseIndex ? updated : item
      )
    );
  }, []);

  // Final import
  const handleImport = useCallback(async () => {
    setStep('importing');
    setError(null);

    try {
      // Build import data
      const selectedPurchases = purchases.filter((p) => p.selected);
      const importData = selectedPurchases.map((purchase) => {
        const inventoryItem = inventoryItems.find(
          (item) => item.purchaseIndex === purchase.index
        );

        return {
          title: purchase.title,
          price: purchase.price,
          purchaseDate: purchase.purchaseDate, // Use the editable date
          vintedStatus: purchase.status,
          inventoryItem: {
            setNumber: inventoryItem?.setNumber || purchase.setNumber || 'UNKNOWN',
            // Use Brickset name if selected, otherwise fall back to Vinted title
            itemName: inventoryItem?.itemName?.trim() ? inventoryItem.itemName : purchase.title,
            condition: inventoryItem?.condition || ('New' as const),
            status: inventoryItem?.status || deriveInventoryStatusFromVinted(purchase.status),
            storageLocation: inventoryItem?.storageLocation || '',
            listingValue: inventoryItem?.listingValue ?? null,
            amazonAsin: inventoryItem?.amazonAsin || '',
            skipCreation: inventoryItem?.skipCreation ?? false,
          },
        };
      });

      const result = await importMutation.mutateAsync({ purchases: importData });

      setImportSummary({
        purchases: result.summary.successfulPurchases,
        inventoryItems: result.summary.totalInventoryItems,
        skipped: result.summary.skippedInventoryItems,
      });

      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import purchases');
      setStep('review-inventory');
    }
  }, [purchases, inventoryItems, importMutation]);

  // Counts
  const selectedCount = purchases.filter((p) => p.selected).length;
  const inventoryToCreate = inventoryItems.filter((i) => !i.skipCreation).length;
  const missingSetNumbers = inventoryItems.filter(
    (i) => !i.skipCreation && !i.setNumber
  ).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Import from Vinted'}
            {step === 'processing' && 'Analyzing Screenshot...'}
            {step === 'review-purchases' && 'Review Purchases'}
            {step === 'review-inventory' && 'Review Inventory Items'}
            {step === 'importing' && 'Importing...'}
            {step === 'complete' && 'Import Complete!'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a screenshot of your Vinted purchases to import them'}
            {step === 'processing' && 'Extracting purchase details and matching with Monzo transactions'}
            {step === 'review-purchases' && `Found ${purchases.length} purchases. Select which ones to import.`}
            {step === 'review-inventory' && `Configure inventory items for ${selectedCount} selected purchases`}
            {step === 'importing' && 'Creating purchases and inventory items...'}
            {step === 'complete' && 'Your purchases have been imported successfully'}
          </DialogDescription>
        </DialogHeader>

        {/* Global error banner - visible across all steps */}
        {error && step !== 'upload' && (
          <div className="mx-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Step content */}
        <div className="flex-1 overflow-hidden">
          {/* Upload Step */}
          {step === 'upload' && (
            <div className="p-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleFileSelect}
                className="hidden"
              />

              {imagePreview ? (
                <div className="relative">
                  <div className="relative aspect-[9/16] max-h-[400px] mx-auto rounded-lg overflow-hidden border">
                    <Image
                      src={imagePreview}
                      alt="Vinted screenshot preview"
                      fill
                      className="object-contain"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => {
                      setImagePreview(null);
                      setImageData(null);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Remove
                  </Button>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-muted/50 transition-colors"
                >
                  <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">
                    Paste, drag and drop, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    JPEG, PNG, WebP, GIF (max 10MB)
                  </p>
                </div>
              )}

              {error && (
                <p className="mt-4 text-sm text-destructive text-center">{error}</p>
              )}
            </div>
          )}

          {/* Processing Step */}
          {step === 'processing' && (
            <div className="p-8 text-center">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">
                {syncMonzoMutation.isPending && 'Syncing Monzo transactions...'}
                {!syncMonzoMutation.isPending && processScreenshot.isParsing && 'Extracting purchases from screenshot...'}
                {!syncMonzoMutation.isPending && processScreenshot.isMatching && 'Matching with Monzo transactions...'}
                {!syncMonzoMutation.isPending && processScreenshot.isCheckingDuplicates && 'Checking for duplicates...'}
              </p>
              <Progress
                value={
                  syncMonzoMutation.isPending
                    ? 10
                    : processScreenshot.isParsing
                    ? 40
                    : processScreenshot.isMatching
                    ? 70
                    : 90
                }
                className="mt-4 max-w-xs mx-auto"
              />
            </div>
          )}

          {/* Review Purchases Step */}
          {step === 'review-purchases' && (
            <ScrollArea className="h-[400px] px-4">
              <div className="space-y-3 py-4">
                {purchases.map((purchase) => (
                  <VintedPurchaseReviewRow
                    key={purchase.index}
                    purchase={purchase}
                    onSelectionChange={handlePurchaseSelectionChange}
                    onDateChange={handlePurchaseDateChange}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Review Inventory Step */}
          {step === 'review-inventory' && (
            <ScrollArea className="h-[400px] px-4">
              <div className="space-y-4 py-4">
                {inventoryItems.map((item) => (
                  <VintedInventoryReviewCard
                    key={item.purchaseIndex}
                    item={item}
                    onChange={handleInventoryItemChange}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Importing Step */}
          {step === 'importing' && (
            <div className="p-8 text-center">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">
                Creating purchases and inventory items...
              </p>
            </div>
          )}

          {/* Complete Step */}
          {step === 'complete' && importSummary && (
            <div className="p-8 text-center">
              <CheckCircle2 className="h-16 w-16 mx-auto text-green-600 mb-4" />
              <div className="space-y-2 text-muted-foreground">
                <p className="flex items-center justify-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Created {importSummary.purchases} purchase{importSummary.purchases !== 1 ? 's' : ''}
                </p>
                <p className="flex items-center justify-center gap-2">
                  <Package className="h-4 w-4" />
                  Created {importSummary.inventoryItems} inventory item{importSummary.inventoryItems !== 1 ? 's' : ''}
                </p>
                {importSummary.skipped > 0 && (
                  <p className="text-sm">
                    ({importSummary.skipped} inventory item{importSummary.skipped !== 1 ? 's' : ''} skipped)
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          {/* Upload Step */}
          {step === 'upload' && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleAnalyze} disabled={!imageData}>
                <Upload className="mr-2 h-4 w-4" />
                Analyse Screenshot
              </Button>
            </>
          )}

          {/* Review Purchases Step */}
          {step === 'review-purchases' && (
            <>
              <div className="flex-1 text-sm text-muted-foreground">
                {selectedCount} of {purchases.length} selected
              </div>
              <Button variant="outline" onClick={() => setStep('upload')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleNextToInventory} disabled={selectedCount === 0}>
                Next: Review Inventory
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}

          {/* Review Inventory Step */}
          {step === 'review-inventory' && (
            <>
              <div className="flex-1 text-sm text-muted-foreground">
                {selectedCount} purchases, {inventoryToCreate} inventory items
                {missingSetNumbers > 0 && (
                  <span className="text-yellow-600 ml-2">
                    ({missingSetNumbers} missing set number{missingSetNumbers !== 1 ? 's' : ''})
                  </span>
                )}
              </div>
              <Button variant="outline" onClick={() => setStep('review-purchases')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleImport} disabled={importMutation.isPending}>
                Import All
              </Button>
            </>
          )}

          {/* Complete Step */}
          {step === 'complete' && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep('upload');
                  setImagePreview(null);
                  setImageData(null);
                  setPurchases([]);
                  setInventoryItems([]);
                  setImportSummary(null);
                }}
              >
                Import More
              </Button>
              <Button onClick={() => router.push('/purchases')}>
                View Purchases
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
