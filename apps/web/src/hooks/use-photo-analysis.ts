/**
 * React Hook for Photo Analysis
 *
 * Provides state management and mutation handling for the
 * photo-based lot evaluation feature.
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  PhotoAnalysisResult,
  PhotoAnalysisItem,
  PrimaryAnalysisModel,
  AIModel,
} from '@/lib/purchase-evaluator/photo-types';
import type {
  ItemRegion,
  RegionDetectionResult,
} from '@/lib/purchase-evaluator/image-chunking.service';

// ============================================
// Types
// ============================================

export interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export interface PhotoAnalysisState {
  images: UploadedImage[];
  listingDescription: string;
  targetMarginPercent: number;
  useGeminiVerification: boolean;
  useBrickognize: boolean;
}

export interface AnalyzePhotosRequest {
  images: Array<{
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    filename?: string;
  }>;
  listingDescription?: string;
  options?: {
    primaryModel?: PrimaryAnalysisModel;
    useGeminiVerification?: boolean;
    useBrickognize?: boolean;
    useImageChunking?: boolean;
    forceChunking?: boolean;
  };
}

// ============================================
// API Function
// ============================================

async function analyzePhotosApi(request: AnalyzePhotosRequest): Promise<PhotoAnalysisResult> {
  const response = await fetch('/api/purchase-evaluator/analyze-photos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();

    // Handle validation errors with more detail
    if (error.details?.fieldErrors) {
      const fieldErrors = error.details.fieldErrors;
      const errorMessages: string[] = [];

      // Check for image-specific errors
      if (fieldErrors.images) {
        errorMessages.push(...fieldErrors.images);
      }

      // Check for nested image errors (e.g., mediaType issues)
      if (error.details?.formErrors?.length > 0) {
        errorMessages.push(...error.details.formErrors);
      }

      if (errorMessages.length > 0) {
        throw new Error(`Image validation failed: ${errorMessages.join(', ')}`);
      }
    }

    throw new Error(error.error || 'Photo analysis failed');
  }

  const data = await response.json();
  return data.data as PhotoAnalysisResult;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Convert File to base64 string
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Get media type from file
 * Normalizes various image types to the supported formats
 */
function getMediaType(file: File): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
  const type = file.type.toLowerCase();

  // Direct matches for supported types
  if (type === 'image/png') return 'image/png';
  if (type === 'image/webp') return 'image/webp';
  if (type === 'image/gif') return 'image/gif';
  if (type === 'image/jpeg' || type === 'image/jpg') return 'image/jpeg';

  // Handle other image types by inferring from filename extension
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';

  // For BMP, TIFF, and other formats, default to PNG (better for screenshots)
  // since they'll be converted via canvas during base64 encoding
  if (type === 'image/bmp' || type === 'image/tiff' || type === 'image/x-icon') {
    return 'image/png';
  }

  // Default to JPEG for unknown types
  return 'image/jpeg';
}

/**
 * Generate unique ID for uploaded image
 */
function generateImageId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// Client-Side Chunking Functions
// ============================================

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

interface ChunkedImageData {
  base64: string;
  mediaType: MediaType;
  filename: string;
  sourceIndex: number;
  region: ItemRegion;
}

/**
 * Detect item regions via API (Claude does region detection server-side)
 */
async function detectRegionsApi(
  base64: string,
  mediaType: MediaType,
  filename?: string
): Promise<RegionDetectionResult> {
  const response = await fetch('/api/purchase-evaluator/detect-regions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: { base64, mediaType, filename },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Region detection failed');
  }

  const data = await response.json();
  return data.data as RegionDetectionResult;
}

/**
 * Crop an image to a specific region using Canvas API (browser only)
 */
function cropImageToRegion(
  imageBase64: string,
  region: ItemRegion,
  mediaType: MediaType
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Calculate pixel coordinates from percentages
        const x = Math.floor((region.x / 100) * img.width);
        const y = Math.floor((region.y / 100) * img.height);
        const width = Math.floor((region.width / 100) * img.width);
        const height = Math.floor((region.height / 100) * img.height);

        // Create canvas for cropping
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        // Draw cropped region
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

        // Convert to base64 (remove data URL prefix)
        const croppedBase64 = canvas.toDataURL(mediaType).replace(/^data:image\/\w+;base64,/, '');

        resolve(croppedBase64);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image for cropping'));
    img.src = `data:${mediaType};base64,${imageBase64}`;
  });
}

/**
 * Process images for chunking - detects regions and crops client-side
 */
async function processImagesClientSide(
  images: Array<{ base64: string; mediaType: MediaType; filename?: string }>,
  onProgress?: (message: string) => void
): Promise<{
  chunkedImages: ChunkedImageData[];
  wasChunked: boolean;
  totalRegions: number;
}> {
  onProgress?.('Detecting item regions...');

  // Step 1: Detect regions for each image
  const detectionResults: RegionDetectionResult[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    onProgress?.(`Analyzing image ${i + 1} of ${images.length}...`);

    try {
      const result = await detectRegionsApi(img.base64, img.mediaType, img.filename);
      detectionResults.push(result);
    } catch (error) {
      console.error(`[Chunking] Failed to detect regions for image ${i}:`, error);
      // Fallback - treat as single region
      detectionResults.push({
        regions: [
          { x: 0, y: 0, width: 100, height: 100, description: 'Full image', itemType: 'unknown' },
        ],
        shouldChunk: false,
        reason: 'Detection failed',
        itemCount: 1,
      });
    }
  }

  // Step 2: Decide if chunking is worthwhile
  const totalRegions = detectionResults.reduce((sum, r) => sum + r.regions.length, 0);
  const anyRecommendChunking = detectionResults.some((r) => r.shouldChunk);
  const shouldChunk = totalRegions > images.length && anyRecommendChunking;

  console.log(
    `[Chunking] Detection complete: ${totalRegions} regions, shouldChunk: ${shouldChunk}`
  );

  if (!shouldChunk) {
    // No chunking needed - return original images as-is
    return {
      chunkedImages: images.map((img, i) => ({
        base64: img.base64,
        mediaType: img.mediaType,
        filename: img.filename || `image-${i + 1}.jpg`,
        sourceIndex: i,
        region: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          description: 'Full image',
          itemType: 'unknown' as const,
        },
      })),
      wasChunked: false,
      totalRegions,
    };
  }

  // Step 3: Crop images client-side
  onProgress?.('Cropping individual items...');
  const chunkedImages: ChunkedImageData[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const detection = detectionResults[i];

    if (detection.regions.length > 1 && detection.shouldChunk) {
      // Multiple regions - crop each one
      for (let j = 0; j < detection.regions.length; j++) {
        const region = detection.regions[j];
        onProgress?.(
          `Cropping region ${j + 1} of ${detection.regions.length} from image ${i + 1}...`
        );

        try {
          const croppedBase64 = await cropImageToRegion(img.base64, region, img.mediaType);
          chunkedImages.push({
            base64: croppedBase64,
            mediaType: img.mediaType,
            filename: `${img.filename || 'image'}-chunk-${j + 1}.jpg`,
            sourceIndex: i,
            region,
          });
        } catch (error) {
          console.error(`[Chunking] Failed to crop region ${j} from image ${i}:`, error);
        }
      }
    } else {
      // Single region - use full image
      chunkedImages.push({
        base64: img.base64,
        mediaType: img.mediaType,
        filename: img.filename || `image-${i + 1}.jpg`,
        sourceIndex: i,
        region: detection.regions[0] || {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          description: 'Full image',
          itemType: 'unknown' as const,
        },
      });
    }
  }

  console.log(`[Chunking] Created ${chunkedImages.length} chunks from ${images.length} images`);

  return {
    chunkedImages,
    wasChunked: true,
    totalRegions,
  };
}

// ============================================
// Main Hook
// ============================================

export function usePhotoAnalysis() {
  // State for uploaded images
  const [images, setImages] = useState<UploadedImage[]>([]);

  // State for listing description
  const [listingDescription, setListingDescription] = useState('');

  // State for target margin
  const [targetMarginPercent, setTargetMarginPercent] = useState(30);

  // State for analysis options
  const [useGeminiVerification, setUseGeminiVerification] = useState(true);
  const [useBrickognize, setUseBrickognize] = useState(true);

  // State for progress messages
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  // State for analysis result
  const [analysisResult, setAnalysisResult] = useState<PhotoAnalysisResult | null>(null);

  // Mutation for running analysis
  const analysisMutation = useMutation({
    mutationFn: analyzePhotosApi,
    onSuccess: (result) => {
      setAnalysisResult(result);
    },
  });

  // Add images handler
  const addImages = useCallback(
    async (files: FileList | File[]) => {
      const newImages: UploadedImage[] = [];

      for (const file of Array.from(files)) {
        // Validate file type - allow empty type for clipboard pastes
        if (file.type && !file.type.startsWith('image/')) {
          console.warn(`[addImages] Skipping non-image file: ${file.name} (type: ${file.type})`);
          continue;
        }

        // Check if we already have 10 images
        if (images.length + newImages.length >= 10) {
          console.warn('[addImages] Maximum 10 images allowed');
          break;
        }

        try {
          const base64 = await fileToBase64(file);
          const mediaType = getMediaType(file);
          const preview = URL.createObjectURL(file);

          console.log(
            `[addImages] Processed image: ${file.name}, type: ${file.type} -> ${mediaType}, base64 length: ${base64.length}`
          );

          newImages.push({
            id: generateImageId(),
            file,
            preview,
            base64,
            mediaType,
          });
        } catch (error) {
          console.error(`[addImages] Failed to process image ${file.name}:`, error);
        }
      }

      setImages((prev) => [...prev, ...newImages]);
    },
    [images.length]
  );

  // Remove image handler
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  // Clear all images
  const clearImages = useCallback(() => {
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
    setAnalysisResult(null);
  }, [images]);

  // Start analysis
  const startAnalysis = useCallback(async () => {
    if (images.length === 0) {
      throw new Error('No images to analyze');
    }

    const request: AnalyzePhotosRequest = {
      images: images.map((img) => ({
        base64: img.base64,
        mediaType: img.mediaType,
        filename: img.file.name,
      })),
      listingDescription: listingDescription || undefined,
      options: {
        useGeminiVerification,
        useBrickognize,
      },
    };

    return analysisMutation.mutateAsync(request);
  }, [images, listingDescription, useGeminiVerification, useBrickognize, analysisMutation]);

  // Update analysis item (for user corrections)
  const updateAnalysisItem = useCallback(
    (itemId: string, updates: Partial<PhotoAnalysisItem>) => {
      if (!analysisResult) return;

      setAnalysisResult((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          items: prev.items.map((item) => (item.id === itemId ? { ...item, ...updates } : item)),
        };
      });
    },
    [analysisResult]
  );

  // Remove analysis item
  const removeAnalysisItem = useCallback(
    (itemId: string) => {
      if (!analysisResult) return;

      setAnalysisResult((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          items: prev.items.filter((item) => item.id !== itemId),
        };
      });
    },
    [analysisResult]
  );

  // Add manual item
  const addManualItem = useCallback(
    (item: Omit<PhotoAnalysisItem, 'id'>) => {
      if (!analysisResult) return;

      const newItem: PhotoAnalysisItem = {
        ...item,
        id: `manual-${Date.now()}`,
      };

      setAnalysisResult((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          items: [...prev.items, newItem],
        };
      });
    },
    [analysisResult]
  );

  // Reset all state
  const reset = useCallback(() => {
    clearImages();
    setListingDescription('');
    setTargetMarginPercent(30);
    setUseGeminiVerification(true);
    setUseBrickognize(true);
    setAnalysisResult(null);
    analysisMutation.reset();
  }, [clearImages, analysisMutation]);

  // Create the analyze function that the wizard expects
  const analyzePhotos = useCallback(
    async (options: {
      primaryModel?: PrimaryAnalysisModel;
      useGeminiVerification?: boolean;
      useBrickognize?: boolean;
      useImageChunking?: boolean;
      listingDescription?: string;
    }) => {
      if (images.length === 0) {
        throw new Error('No images to analyze');
      }

      const useChunking = options.useImageChunking ?? true;
      let imagesToSend: Array<{ base64: string; mediaType: MediaType; filename?: string }>;

      if (useChunking) {
        // Perform client-side chunking
        setProgressMessage('Detecting item regions...');
        try {
          const chunkingResult = await processImagesClientSide(
            images.map((img) => ({
              base64: img.base64,
              mediaType: img.mediaType,
              filename: img.file.name,
            })),
            setProgressMessage
          );

          imagesToSend = chunkingResult.chunkedImages.map((chunk) => ({
            base64: chunk.base64,
            mediaType: chunk.mediaType,
            filename: chunk.filename,
          }));

          console.log(
            `[analyzePhotos] ${chunkingResult.wasChunked ? 'Chunked' : 'Not chunked'}: ${imagesToSend.length} images to send`
          );
        } catch (error) {
          console.error('[analyzePhotos] Chunking failed, using original images:', error);
          // Fallback to original images
          imagesToSend = images.map((img) => ({
            base64: img.base64,
            mediaType: img.mediaType,
            filename: img.file.name,
          }));
        }
      } else {
        // No chunking - use original images
        imagesToSend = images.map((img) => ({
          base64: img.base64,
          mediaType: img.mediaType,
          filename: img.file.name,
        }));
      }

      // Batch images if more than 10 (API limit)
      const MAX_IMAGES_PER_REQUEST = 10;
      const batches: Array<typeof imagesToSend> = [];

      for (let i = 0; i < imagesToSend.length; i += MAX_IMAGES_PER_REQUEST) {
        batches.push(imagesToSend.slice(i, i + MAX_IMAGES_PER_REQUEST));
      }

      console.log(
        `[analyzePhotos] Processing ${imagesToSend.length} images in ${batches.length} batch(es)`
      );

      try {
        // Process each batch and merge results
        const allItems: PhotoAnalysisResult['items'] = [];
        let totalProcessingTime = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          const batchLabel =
            batches.length > 1 ? ` (batch ${batchIndex + 1}/${batches.length})` : '';

          setProgressMessage(
            options.primaryModel === 'gemini'
              ? `Analyzing with Gemini Pro${batchLabel}...`
              : `Analyzing with Claude${batchLabel}...`
          );

          const request: AnalyzePhotosRequest = {
            images: batch,
            listingDescription: options.listingDescription,
            options: {
              primaryModel: options.primaryModel ?? 'gemini',
              useGeminiVerification: options.useGeminiVerification ?? useGeminiVerification,
              useBrickognize: options.useBrickognize ?? useBrickognize,
              useImageChunking: false,
            },
          };

          const batchResult = await analysisMutation.mutateAsync(request);
          allItems.push(...batchResult.items);
          totalProcessingTime += batchResult.processingTimeMs;
        }

        // Merge results from all batches
        const mergedResult: PhotoAnalysisResult = {
          items: allItems,
          processingTimeMs: totalProcessingTime,
          modelsUsed: [
            (options.primaryModel === 'claude'
              ? 'opus'
              : (options.primaryModel ?? 'gemini')) as AIModel,
          ],
          overallNotes: '',
          analysisConfidence:
            allItems.length > 0
              ? allItems.reduce((sum, item) => sum + (item.confidenceScore || 0), 0) /
                allItems.length
              : 0,
          warnings: [],
          sourceDescription: listingDescription || null,
        };

        setProgressMessage(null);
        setAnalysisResult(mergedResult);
        return mergedResult;
      } catch (error) {
        setProgressMessage(null);
        throw error;
      }
    },
    [
      images,
      useGeminiVerification,
      useBrickognize,
      analysisMutation,
      setAnalysisResult,
      listingDescription,
    ]
  );

  return {
    // Image state
    images,
    addImages,
    removeImage,
    clearImages,

    // Listing description
    listingDescription,
    setListingDescription,

    // Target margin
    targetMarginPercent,
    setTargetMarginPercent,

    // Analysis options
    useGeminiVerification,
    setUseGeminiVerification,
    useBrickognize,
    setUseBrickognize,

    // Analysis
    startAnalysis,
    analyzePhotos,
    analysisResult,
    result: analysisResult, // Alias for wizard compatibility
    isAnalyzing: analysisMutation.isPending,
    progressMessage, // Current progress message during analysis
    analysisError: analysisMutation.error,

    // Result manipulation
    updateAnalysisItem,
    removeAnalysisItem,
    addManualItem,

    // Reset
    reset,

    // Computed
    canAnalyze: images.length > 0 && !analysisMutation.isPending,
    hasResult: !!analysisResult,
  };
}

// ============================================
// Additional Hooks
// ============================================

/**
 * Hook for file drop handling
 */
export function useImageDrop(onDrop: (files: FileList) => void) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        onDrop(files);
      }
    },
    [onDrop]
  );

  return {
    isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  };
}
