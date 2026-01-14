/**
 * Image Processor Hook
 *
 * State and logic for the Image Studio tab.
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import type {
  StudioImage,
  ImageProcessSettings,
  ImageAnalysisResult,
} from '@/lib/listing-assistant/types';
import { DEFAULT_IMAGE_SETTINGS } from '@/lib/listing-assistant/constants';
import {
  fileToBase64,
  processImage,
  processImagePreview,
  downloadImage,
  generateFilename,
  resizeImage,
} from '@/lib/listing-assistant/image-processing';

// ============================================
// API Function for Analysis
// ============================================

async function analyzeImageApi(imageBase64: string): Promise<ImageAnalysisResult> {
  const response = await fetch('/api/listing-assistant/analyze-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to analyze image');
  }

  const { data } = await response.json();
  return data;
}

// ============================================
// Hook
// ============================================

export function useImageProcessor() {
  const [images, setImages] = useState<StudioImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Get the currently selected image
  const selectedImage = images.find((img) => img.id === selectedId) || null;

  // Mutation for AI analysis
  const analyzeMutation = useMutation({
    mutationFn: analyzeImageApi,
  });

  /**
   * Add images from files
   */
  const addImages = useCallback(async (files: File[]) => {
    const newImages: StudioImage[] = [];

    for (const file of files) {
      try {
        // Convert to base64
        let base64 = await fileToBase64(file);

        // Resize if too large
        base64 = await resizeImage(base64, 1500);

        const newImage: StudioImage = {
          id: uuidv4(),
          name: file.name.replace(/\.[^/.]+$/, ''),
          fileName: file.name,
          original: base64,
          processed: null,
          settings: { ...DEFAULT_IMAGE_SETTINGS },
          analysis: null,
          isProcessing: false,
          isAnalyzing: false,
          isFixing: false,
        };

        newImages.push(newImage);
      } catch (error) {
        console.error('Failed to load image:', file.name, error);
      }
    }

    setImages((prev) => [...prev, ...newImages]);

    // Select the first new image if none selected
    if (newImages.length > 0 && !selectedId) {
      setSelectedId(newImages[0].id);
    }
  }, [selectedId]);

  /**
   * Remove an image
   */
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const filtered = prev.filter((img) => img.id !== id);

      // If we removed the selected image, select another
      if (selectedId === id) {
        setSelectedId(filtered.length > 0 ? filtered[0].id : null);
      }

      return filtered;
    });
  }, [selectedId]);

  /**
   * Update settings for an image
   */
  const updateSettings = useCallback(
    async (id: string, settings: Partial<ImageProcessSettings>) => {
      setImages((prev) =>
        prev.map((img) => {
          if (img.id !== id) return img;
          return {
            ...img,
            settings: { ...img.settings, ...settings },
            isProcessing: true,
          };
        })
      );

      // Process the image with new settings
      const image = images.find((img) => img.id === id);
      if (!image) return;

      try {
        const newSettings = { ...image.settings, ...settings };
        const processed = await processImagePreview(image.original, newSettings);

        setImages((prev) =>
          prev.map((img) => {
            if (img.id !== id) return img;
            return {
              ...img,
              processed,
              settings: newSettings,
              isProcessing: false,
            };
          })
        );
      } catch (error) {
        console.error('Failed to process image:', error);
        setImages((prev) =>
          prev.map((img) => {
            if (img.id !== id) return img;
            return { ...img, isProcessing: false };
          })
        );
      }
    },
    [images]
  );

  /**
   * Reset settings to defaults
   */
  const resetSettings = useCallback(
    (id: string) => {
      updateSettings(id, DEFAULT_IMAGE_SETTINGS);
    },
    [updateSettings]
  );

  /**
   * Apply a preset to an image
   */
  const applyPreset = useCallback(
    (id: string, preset: ImageProcessSettings) => {
      updateSettings(id, preset);
    },
    [updateSettings]
  );

  /**
   * Analyze an image with AI
   */
  const analyzeImage = useCallback(
    async (id: string) => {
      const image = images.find((img) => img.id === id);
      if (!image) return;

      setImages((prev) =>
        prev.map((img) => {
          if (img.id !== id) return img;
          return { ...img, isAnalyzing: true };
        })
      );

      try {
        const imageToAnalyze = image.processed || image.original;
        const analysis = await analyzeMutation.mutateAsync(imageToAnalyze);

        setImages((prev) =>
          prev.map((img) => {
            if (img.id !== id) return img;
            return {
              ...img,
              analysis,
              name: analysis.suggestedFilename || img.name,
              isAnalyzing: false,
            };
          })
        );
      } catch (error) {
        console.error('Failed to analyze image:', error);
        setImages((prev) =>
          prev.map((img) => {
            if (img.id !== id) return img;
            return { ...img, isAnalyzing: false };
          })
        );
      }
    },
    [images, analyzeMutation]
  );

  /**
   * Process and download a single image
   */
  const downloadSingle = useCallback(
    async (id: string) => {
      const image = images.find((img) => img.id === id);
      if (!image) return;

      try {
        const processed = await processImage(image.original, image.settings);
        const filename = generateFilename(image.name, 0);
        downloadImage(processed, filename);
      } catch (error) {
        console.error('Failed to download image:', error);
      }
    },
    [images]
  );

  /**
   * Process and download all images
   */
  const downloadAll = useCallback(async () => {
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      try {
        const processed = await processImage(image.original, image.settings);
        const filename = generateFilename(image.name, i);
        downloadImage(processed, filename);

        // Small delay between downloads to avoid browser issues
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Failed to download image:', image.name, error);
      }
    }
  }, [images]);

  /**
   * Clear all images
   */
  const clearAll = useCallback(() => {
    setImages([]);
    setSelectedId(null);
  }, []);

  return {
    images,
    selectedId,
    selectedImage,
    setSelectedId,
    addImages,
    removeImage,
    updateSettings,
    resetSettings,
    applyPreset,
    analyzeImage,
    downloadSingle,
    downloadAll,
    clearAll,
    isAnalyzing: analyzeMutation.isPending,
  };
}
