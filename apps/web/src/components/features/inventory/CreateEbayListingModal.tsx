'use client';

/**
 * Create eBay Listing Modal
 *
 * Modal for creating eBay listings from inventory items.
 * Includes sections for pricing, photos, content generation, and publishing options.
 */

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Upload, ImageIcon, AlertCircle, CheckCircle2, ExternalLink, Sparkles, RefreshCw } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/utils';
import { useCreateListing } from '@/hooks/use-create-listing';
import { useBusinessPolicies } from '@/hooks/use-business-policies';
import { useTemplates } from '@/hooks/listing-assistant/use-templates';
import { useStorageLocations } from '@/hooks/use-storage-locations';
import { QualityReviewPopup } from './QualityReviewPopup';
import { ListingPreviewScreen } from './ListingPreviewScreen';
import { compressImage, formatBytes } from '@/lib/utils/image-compression';
import type {
  ListingCreationRequest,
  DescriptionStyle,
  ListingType,
  BestOfferConfig,
  ListingImageUrl,
} from '@/lib/ebay/listing-creation.types';

/**
 * Local photo state - tracks compressed base64 before upload and URL after upload
 */
interface LocalPhoto {
  id: string;
  filename: string;
  /** Compressed base64 for preview (before upload) */
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  enhanced: boolean;
  /** URL from storage (after upload) */
  url?: string;
  /** Upload status */
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'error';
  /** Error message if upload failed */
  uploadError?: string;
  /** Original size before compression */
  originalSize?: number;
  /** Compressed size */
  compressedSize?: number;
}

/**
 * Generate default condition description template
 */
function generateConditionDescription(condition: string | null | undefined, _setName: string | null | undefined): string {
  const conditionText = condition || 'Used';
  return `In ${conditionText} condition. Please refer to photos.`;
}

interface CreateEbayListingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventoryItem: {
    id: string;
    set_number: string;
    set_name?: string | null;
    theme?: string | null;
    condition?: string | null;
    listing_value?: number | null;
    status?: string | null;
    ebay_listing_id?: string | null;
  };
}

/**
 * Default Best Offer configuration
 */
const defaultBestOffer: BestOfferConfig = {
  enabled: true,
  autoAcceptPercent: 95,
  autoDeclinePercent: 75,
};

/**
 * Description style options
 */
const descriptionStyles: Array<{ value: DescriptionStyle; label: string; description: string }> = [
  { value: 'Minimalist', label: 'Minimalist', description: 'Clean and concise' },
  { value: 'Standard', label: 'Standard', description: 'Balanced and informative' },
  { value: 'Professional', label: 'Professional', description: 'Formal and detailed' },
  { value: 'Friendly', label: 'Friendly', description: 'Warm and approachable' },
  { value: 'Enthusiastic', label: 'Enthusiastic', description: 'Energetic and persuasive' },
];

export function CreateEbayListingModal({
  open,
  onOpenChange,
  inventoryItem,
}: CreateEbayListingModalProps) {
  // Form state
  const [price, setPrice] = useState(inventoryItem.listing_value?.toString() ?? '');
  const [bestOffer, setBestOffer] = useState<BestOfferConfig>(defaultBestOffer);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [enhancePhotos, setEnhancePhotos] = useState(true);
  const [descriptionStyle, setDescriptionStyle] = useState<DescriptionStyle>('Standard');
  const [listingType, setListingType] = useState<ListingType>('live');
  const [scheduledDate, setScheduledDate] = useState('');

  // Policy selection state
  const [selectedFulfillmentPolicyId, setSelectedFulfillmentPolicyId] = useState<string | undefined>();

  // Template selection state - 'ai' means use AI-generated format (no template)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('ai');

  // Condition description state
  const [useAIConditionDescription, setUseAIConditionDescription] = useState(false);
  const [conditionDescription, setConditionDescription] = useState(
    generateConditionDescription(inventoryItem.condition, inventoryItem.set_name)
  );

  // Quality review popup state
  const [showQualityReview, setShowQualityReview] = useState(false);

  // Storage location state
  const [storageLocation, setStorageLocation] = useState('');

  // Hooks
  const {
    progress,
    result,
    error,
    isCreating,
    previewData,
    isAwaitingPreviewConfirmation,
    create,
    reset,
    confirmPreview,
    cancelPreview,
  } = useCreateListing();

  // Business policies hook with refresh capability
  const {
    data: policies,
    isLoading: policiesLoading,
    refresh: refreshPolicies,
    isRefreshing: isPoliciesRefreshing,
  } = useBusinessPolicies();

  // Templates hook
  const { data: templates, isLoading: templatesLoading } = useTemplates();

  // Storage locations hook for autocomplete
  const { data: storageLocations = [] } = useStorageLocations();

  // Get fulfillment policies for the dropdown (postage policies)
  const fulfillmentPolicies = policies?.fulfillment ?? [];

  // Find Small Parcel policy as default
  const smallParcelPolicy = fulfillmentPolicies.find(p =>
    p.name.toLowerCase().includes('small parcel')
  );

  // Use selected policy, or default to Small Parcel, or first available
  const effectiveFulfillmentPolicyId = selectedFulfillmentPolicyId
    ?? smallParcelPolicy?.id
    ?? policies?.defaults.fulfillmentPolicyId;

  /**
   * Handle photo upload - compresses images before adding to state
   */
  const handlePhotoUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      setIsCompressing(true);
      const newPhotos: LocalPhoto[] = [];

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file.type.startsWith('image/')) continue;

          // Compress image to reduce payload size
          const compressed = await compressImage(file, {
            maxDimension: 1600,
            quality: 0.8,
            outputType: 'image/jpeg',
          });

          newPhotos.push({
            id: `${Date.now()}-${i}`,
            filename: file.name,
            base64: compressed.base64,
            mimeType: compressed.mimeType,
            enhanced: false,
            uploadStatus: 'pending',
            originalSize: compressed.originalSize,
            compressedSize: compressed.compressedSize,
          });
        }

        setPhotos((prev) => [...prev, ...newPhotos].slice(0, 24)); // Max 24 photos
      } finally {
        setIsCompressing(false);
      }
    },
    []
  );

  /**
   * Upload photos to storage in batches
   * Returns array of uploaded photos with URLs, or null if upload failed
   */
  const uploadPhotosToStorage = useCallback(async (): Promise<LocalPhoto[] | null> => {
    // Work with a local copy of photos to track updates
    let workingPhotos = [...photos];

    const pendingPhotos = workingPhotos.filter((p) => p.uploadStatus === 'pending' || p.uploadStatus === 'error');
    if (pendingPhotos.length === 0) {
      // All photos already uploaded - return them directly
      const allUploaded = workingPhotos.every((p) => p.uploadStatus === 'uploaded');
      return allUploaded ? workingPhotos : null;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const BATCH_SIZE = 5;
    let uploadedCount = 0;
    let allSucceeded = true;

    try {
      // Process in batches
      for (let i = 0; i < pendingPhotos.length; i += BATCH_SIZE) {
        const batch = pendingPhotos.slice(i, i + BATCH_SIZE);

        // Mark batch as uploading (for UI)
        setPhotos((prev) =>
          prev.map((p) =>
            batch.find((b) => b.id === p.id)
              ? { ...p, uploadStatus: 'uploading' as const }
              : p
          )
        );

        // Upload batch
        const response = await fetch('/api/ebay/upload-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: batch.map((p) => ({
              id: p.id,
              filename: p.filename,
              base64: p.base64,
              mimeType: p.mimeType,
            })),
            inventoryItemId: inventoryItem.id,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('[uploadPhotosToStorage] Upload failed:', errorData);
          // Mark all batch photos as error
          workingPhotos = workingPhotos.map((p) =>
            batch.find((b) => b.id === p.id)
              ? { ...p, uploadStatus: 'error' as const, uploadError: errorData.error || 'Upload failed' }
              : p
          );
          setPhotos(workingPhotos);
          allSucceeded = false;
          continue;
        }

        const data = await response.json();

        // Update working photos with URLs
        workingPhotos = workingPhotos.map((p) => {
          const result = data.results?.find((r: { id: string; success: boolean; url?: string; error?: string }) => r.id === p.id);
          if (result) {
            if (result.success && result.url) {
              return { ...p, url: result.url, uploadStatus: 'uploaded' as const };
            } else {
              allSucceeded = false;
              return { ...p, uploadStatus: 'error' as const, uploadError: result.error || 'Upload failed' };
            }
          }
          return p;
        });

        // Update state for UI
        setPhotos(workingPhotos);

        uploadedCount += batch.length;
        setUploadProgress(Math.round((uploadedCount / pendingPhotos.length) * 100));
      }

      return allSucceeded ? workingPhotos : null;
    } finally {
      setIsUploading(false);
    }
  }, [photos, inventoryItem.id]);

  /**
   * Remove a photo
   */
  const removePhoto = useCallback((photoId: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  }, []);

  /**
   * Handle form submission - uploads photos first, then creates listing
   */
  const handleSubmit = useCallback(async () => {
    const priceValue = parseFloat(price);
    if (isNaN(priceValue) || priceValue <= 0) {
      return;
    }

    // Photos are required for all listings
    if (photos.length === 0) {
      return;
    }

    // Step 1: Upload photos to storage and get back the photos with URLs
    const uploadedPhotosResult = await uploadPhotosToStorage();
    if (!uploadedPhotosResult) {
      console.error('[handleSubmit] Photo upload failed');
      return;
    }

    // Step 2: Convert to ListingImageUrl format (using returned data, not state)
    const uploadedPhotos: ListingImageUrl[] = uploadedPhotosResult
      .filter((p) => p.uploadStatus === 'uploaded' && p.url)
      .map((p) => ({
        id: p.id,
        filename: p.filename,
        url: p.url!,
        mimeType: p.mimeType,
        enhanced: p.enhanced,
      }));

    if (uploadedPhotos.length === 0) {
      console.error('[handleSubmit] No photos uploaded successfully');
      return;
    }

    // Step 3: Create listing with URLs (not base64)
    const request: ListingCreationRequest = {
      inventoryItemId: inventoryItem.id,
      price: priceValue,
      bestOffer,
      photos: uploadedPhotos,
      enhancePhotos,
      descriptionStyle,
      listingType,
      scheduledDate: listingType === 'scheduled' ? scheduledDate : undefined,
      // Template ID (if using a saved template)
      templateId: selectedTemplateId !== 'ai' ? selectedTemplateId : undefined,
      // Policy overrides - use selected fulfillment policy
      policyOverrides: effectiveFulfillmentPolicyId
        ? { fulfillmentPolicyId: effectiveFulfillmentPolicyId }
        : undefined,
      // Condition description override (if not using AI)
      conditionDescriptionOverride: useAIConditionDescription ? undefined : conditionDescription,
      // Storage location to update on the inventory item
      storageLocation: storageLocation.trim() || undefined,
    };

    create(request);
  }, [
    inventoryItem.id,
    price,
    bestOffer,
    photos,
    enhancePhotos,
    descriptionStyle,
    listingType,
    scheduledDate,
    selectedTemplateId,
    effectiveFulfillmentPolicyId,
    useAIConditionDescription,
    conditionDescription,
    storageLocation,
    create,
    uploadPhotosToStorage,
  ]);

  /**
   * Handle close - reset state if needed
   */
  const handleClose = useCallback(() => {
    if (!isCreating) {
      reset();
      onOpenChange(false);
    }
  }, [isCreating, reset, onOpenChange]);

  /**
   * Check if item is already listed
   */
  const isAlreadyListed = !!inventoryItem.ebay_listing_id;

  /**
   * Render content based on state
   */
  const renderContent = () => {
    // Success state
    if (result?.success) {
      return (
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-center">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold">Listing Created Successfully!</h3>
            <p className="text-muted-foreground">{result.title}</p>
            <p className="mt-2 text-2xl font-bold">{formatCurrency(result.price)}</p>
          </div>
          {/* Quality Review Button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowQualityReview(true)}
          >
            <Sparkles className="mr-2 h-4 w-4 text-purple-500" />
            {result.qualityReviewPending ? 'View Quality Review (In Progress...)' : 'View Quality Review'}
          </Button>

          {/* Quality Review Popup */}
          <QualityReviewPopup
            isOpen={showQualityReview}
            auditId={result.auditId}
            listingUrl={result.listingUrl}
            onClose={() => setShowQualityReview(false)}
          />
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
            <Button asChild>
              <a href={result.listingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                View on eBay
              </a>
            </Button>
          </div>
        </div>
      );
    }

    // Error state
    if (error) {
      const errorMessage = typeof error === 'string' ? error : error.error;
      return (
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-center">
            <AlertCircle className="h-16 w-16 text-destructive" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold">Listing Creation Failed</h3>
            <p className="text-muted-foreground">{errorMessage}</p>
            {typeof error !== 'string' && error.failedStep && (
              <p className="mt-1 text-sm text-muted-foreground">Failed at: {error.failedStep}</p>
            )}
          </div>
          {typeof error !== 'string' && error.draftSaved && (
            <Alert>
              <AlertDescription>
                Your progress has been saved as a draft. You can resume later.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
            <Button onClick={reset}>Try Again</Button>
          </div>
        </div>
      );
    }

    // Preview state - show ListingPreviewScreen for user confirmation
    if (isAwaitingPreviewConfirmation && previewData) {
      return (
        <ListingPreviewScreen
          listing={previewData.listing}
          qualityReview={previewData.qualityReview}
          price={previewData.price}
          photoUrls={previewData.photoUrls}
          isReviewLoading={false}
          reviewError={previewData.qualityReviewFailed ? previewData.qualityReviewError : null}
          onConfirm={confirmPreview}
          onCancel={cancelPreview}
          isConfirming={isCreating && !isAwaitingPreviewConfirmation}
        />
      );
    }

    // Progress state
    if (isCreating && progress) {
      return (
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{progress.stepName}</span>
              <span>{progress.percentage}%</span>
            </div>
            <Progress value={progress.percentage} />
          </div>
          <div className="space-y-2">
            {progress.steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2">
                {step.status === 'completed' && (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
                {step.status === 'in_progress' && (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                )}
                {step.status === 'pending' && (
                  <div className="h-4 w-4 rounded-full border border-muted-foreground" />
                )}
                {step.status === 'failed' && (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )}
                <span
                  className={
                    step.status === 'completed'
                      ? 'text-muted-foreground'
                      : step.status === 'in_progress'
                        ? 'font-medium'
                        : ''
                  }
                >
                  {step.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Form state
    return (
      <Tabs defaultValue="pricing" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="publish">Publish</TabsTrigger>
        </TabsList>

        {/* Pricing Tab */}
        <TabsContent value="pricing" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="price">Listing Price (GBP)</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Enter price"
            />
          </div>

          <Card>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Best Offer</CardTitle>
                <Switch
                  checked={bestOffer.enabled}
                  onCheckedChange={(enabled: boolean) =>
                    setBestOffer((prev) => ({ ...prev, enabled }))
                  }
                />
              </div>
            </CardHeader>
            {bestOffer.enabled && (
              <CardContent className="space-y-4 py-3">
                <div className="space-y-2">
                  <Label htmlFor="autoAccept">Auto-Accept at {bestOffer.autoAcceptPercent}%</Label>
                  <Input
                    id="autoAccept"
                    type="number"
                    min="0"
                    max="100"
                    value={bestOffer.autoAcceptPercent}
                    onChange={(e) =>
                      setBestOffer((prev) => ({
                        ...prev,
                        autoAcceptPercent: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                  {price && (
                    <p className="text-xs text-muted-foreground">
                      Auto-accept offers at or above{' '}
                      {formatCurrency((parseFloat(price) * bestOffer.autoAcceptPercent) / 100)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="autoDecline">
                    Auto-Decline below {bestOffer.autoDeclinePercent}%
                  </Label>
                  <Input
                    id="autoDecline"
                    type="number"
                    min="0"
                    max="100"
                    value={bestOffer.autoDeclinePercent}
                    onChange={(e) =>
                      setBestOffer((prev) => ({
                        ...prev,
                        autoDeclinePercent: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                  {price && (
                    <p className="text-xs text-muted-foreground">
                      Auto-decline offers below{' '}
                      {formatCurrency((parseFloat(price) * bestOffer.autoDeclinePercent) / 100)}
                    </p>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        {/* Photos Tab */}
        <TabsContent value="photos" className="space-y-4">
          <div className="space-y-2">
            <Label>Photos ({photos.length}/24)</Label>
            <div className="flex items-center justify-center rounded-lg border-2 border-dashed p-8">
              <label className={`cursor-pointer text-center ${isCompressing ? 'pointer-events-none opacity-50' : ''}`}>
                {isCompressing ? (
                  <>
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Compressing images...
                    </p>
                  </>
                ) : (
                  <>
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Images are automatically compressed to reduce upload size
                    </p>
                  </>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                  disabled={isCompressing}
                />
              </label>
            </div>
          </div>

          {/* Upload progress indicator */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Uploading photos...</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {photos.length > 0 && (
            <>
              {/* Photo size summary */}
              <div className="text-xs text-muted-foreground">
                Total compressed size:{' '}
                {formatBytes(photos.reduce((sum, p) => sum + (p.compressedSize || 0), 0))}
                {' (saved '}
                {formatBytes(
                  photos.reduce((sum, p) => sum + ((p.originalSize || 0) - (p.compressedSize || 0)), 0)
                )}
                {')'}
              </div>

              <div className="grid grid-cols-4 gap-2">
                {photos.map((photo, index) => (
                  <div key={photo.id} className="relative">
                    <img
                      src={photo.base64}
                      alt={`Photo ${index + 1}`}
                      className={`aspect-square rounded-md object-cover ${
                        photo.uploadStatus === 'error' ? 'opacity-50 ring-2 ring-destructive' : ''
                      }`}
                    />
                    {/* Upload status indicator */}
                    {photo.uploadStatus === 'uploading' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-md">
                        <Loader2 className="h-6 w-6 animate-spin text-white" />
                      </div>
                    )}
                    {photo.uploadStatus === 'uploaded' && (
                      <div className="absolute top-1 right-1">
                        <CheckCircle2 className="h-4 w-4 text-green-500 bg-white rounded-full" />
                      </div>
                    )}
                    {photo.uploadStatus === 'error' && (
                      <div className="absolute top-1 right-1">
                        <AlertCircle className="h-4 w-4 text-destructive bg-white rounded-full" />
                      </div>
                    )}
                    <button
                      type="button"
                      className="absolute -right-1 -top-1 rounded-full bg-destructive p-1 text-destructive-foreground"
                      onClick={() => removePhoto(photo.id)}
                      disabled={photo.uploadStatus === 'uploading'}
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                    {index === 0 && (
                      <Badge className="absolute bottom-1 left-1" variant="secondary">
                        Primary
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center space-x-2">
            <Switch
              id="enhance"
              checked={enhancePhotos}
              onCheckedChange={setEnhancePhotos}
            />
            <Label htmlFor="enhance">Optimise photos for eBay</Label>
          </div>
        </TabsContent>

        {/* Content Tab */}
        <TabsContent value="content" className="space-y-4">
          {/* Description Template */}
          <div className="space-y-2">
            <Label>Description Template</Label>
            <Select
              value={selectedTemplateId}
              onValueChange={setSelectedTemplateId}
              disabled={templatesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={templatesLoading ? 'Loading templates...' : 'Select template'} />
              </SelectTrigger>
              <SelectContent>
                {/* AI Generated option */}
                <SelectItem value="ai">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    <span className="font-medium">AI Generated</span>
                    <span className="text-muted-foreground">- Let AI create the format</span>
                  </div>
                </SelectItem>
                {/* Saved templates */}
                {templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{template.name}</span>
                      {template.is_default && (
                        <Badge variant="secondary" className="text-xs">Default</Badge>
                      )}
                      <span className="text-muted-foreground text-xs">({template.type})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedTemplateId === 'ai'
                ? 'AI will generate a structured description based on the item details.'
                : 'The selected template will be used as the structure for your listing description.'}
            </p>
          </div>

          {/* Description Style */}
          <div className="space-y-2">
            <Label>Description Style</Label>
            <Select
              value={descriptionStyle}
              onValueChange={(v: string) => setDescriptionStyle(v as DescriptionStyle)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {descriptionStyles.map((style) => (
                  <SelectItem key={style.value} value={style.value}>
                    <div>
                      <span className="font-medium">{style.label}</span>
                      <span className="ml-2 text-muted-foreground">{style.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Condition Description */}
          <Card>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Condition Description</CardTitle>
                <div className="flex items-center space-x-2">
                  <Label htmlFor="useAI" className="text-xs text-muted-foreground">
                    AI Generated
                  </Label>
                  <Switch
                    id="useAI"
                    checked={useAIConditionDescription}
                    onCheckedChange={setUseAIConditionDescription}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="py-3">
              {useAIConditionDescription ? (
                <p className="text-sm text-muted-foreground italic">
                  AI will generate a detailed condition description based on the item&apos;s condition and photos.
                </p>
              ) : (
                <Textarea
                  value={conditionDescription}
                  onChange={(e) => setConditionDescription(e.target.value)}
                  placeholder="Enter condition description..."
                  rows={3}
                  className="resize-none"
                />
              )}
            </CardContent>
          </Card>

          <Alert>
            <ImageIcon className="h-4 w-4" />
            <AlertDescription>
              AI will generate an optimised title, description, and item specifics based on your
              inventory data and product research.
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* Publish Tab */}
        <TabsContent value="publish" className="space-y-4">
          {/* Storage Location */}
          <div className="space-y-2">
            <Label htmlFor="storageLocation">Storage Location</Label>
            <Input
              id="storageLocation"
              type="text"
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              placeholder="e.g., Shelf A1, Box 3"
              list="storage-locations-list"
            />
            <datalist id="storage-locations-list">
              {storageLocations.map((location) => (
                <option key={location} value={location} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Where the item is stored. Start typing to see suggestions from existing locations.
            </p>
          </div>

          {/* Postage Policy Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Postage Policy</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refreshPolicies()}
                disabled={isPoliciesRefreshing}
                className="h-8 px-2"
              >
                <RefreshCw className={`h-4 w-4 ${isPoliciesRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <Select
              value={effectiveFulfillmentPolicyId ?? ''}
              onValueChange={(v: string) => setSelectedFulfillmentPolicyId(v || undefined)}
              disabled={policiesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={policiesLoading ? 'Loading policies...' : 'Select postage policy'} />
              </SelectTrigger>
              <SelectContent>
                {fulfillmentPolicies.map((policy) => (
                  <SelectItem key={policy.id} value={policy.id}>
                    {policy.name}
                    {policy.isDefault && <Badge variant="secondary" className="ml-2 text-xs">Default</Badge>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {smallParcelPolicy && !selectedFulfillmentPolicyId && (
              <p className="text-xs text-muted-foreground">
                Defaulting to &quot;{smallParcelPolicy.name}&quot;
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Publishing Option</Label>
            <ToggleGroup
              type="single"
              value={listingType}
              onValueChange={(v: string) => {
                if (v) setListingType(v as ListingType);
              }}
              className="justify-start"
            >
              <ToggleGroupItem value="live" aria-label="Publish Immediately">
                Live
              </ToggleGroupItem>
              <ToggleGroupItem value="scheduled" aria-label="Schedule for Later">
                Scheduled
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {listingType === 'scheduled' && (
            <div className="space-y-2">
              <Label htmlFor="scheduledDate">Schedule Date & Time</Label>
              <Input
                id="scheduledDate"
                type="datetime-local"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)}
              />
            </div>
          )}

          <div className="pt-4">
            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmit}
              disabled={
                !price ||
                parseFloat(price) <= 0 ||
                photos.length === 0 ||
                (listingType === 'scheduled' && !scheduledDate) ||
                policiesLoading ||
                isCompressing ||
                isUploading
              }
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading Photos...
                </>
              ) : listingType === 'scheduled' ? (
                'Schedule Listing'
              ) : (
                'Create Listing'
              )}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {result?.success
              ? 'Listing Created'
              : error
                ? 'Error'
                : `Create eBay Listing - ${inventoryItem.set_number}`}
          </DialogTitle>
          {!result && !error && !isCreating && (
            <DialogDescription>
              {inventoryItem.set_name || 'Set'} - {inventoryItem.condition || 'Unknown condition'}
            </DialogDescription>
          )}
        </DialogHeader>

        {isAlreadyListed ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This item already has an eBay listing (ID: {inventoryItem.ebay_listing_id})
            </AlertDescription>
          </Alert>
        ) : (
          renderContent()
        )}
      </DialogContent>
    </Dialog>
  );
}

