/**
 * Generator Hooks
 *
 * React Query hooks for AI listing generation.
 */

import { useMutation } from '@tanstack/react-query';
import type {
  GenerateListingRequest,
  GenerateListingResponse,
  AnalyzeImageResponse,
} from '@/lib/listing-assistant/types';

// ============================================
// API Functions
// ============================================

async function generateListing(
  input: GenerateListingRequest
): Promise<GenerateListingResponse> {
  const response = await fetch('/api/listing-assistant/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to generate listing');
  }

  const { data } = await response.json();
  return data;
}

async function analyzeImage(imageBase64: string): Promise<AnalyzeImageResponse> {
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
// Hooks
// ============================================

/**
 * Hook to generate a listing using AI
 */
export function useGenerateListing() {
  return useMutation({
    mutationFn: generateListing,
  });
}

/**
 * Hook to analyze an image with AI
 */
export function useAnalyzeImage() {
  return useMutation({
    mutationFn: analyzeImage,
  });
}
