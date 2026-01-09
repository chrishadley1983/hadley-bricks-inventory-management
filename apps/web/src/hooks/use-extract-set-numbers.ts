'use client';

import { useMutation } from '@tanstack/react-query';
import type { ExtractedSetNumber } from '@/lib/ai';

interface ExtractSetNumbersInput {
  images: Array<{
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  }>;
}

interface ExtractSetNumbersResponse {
  extractions: ExtractedSetNumber[];
  notes?: string;
  total_found: number;
}

/**
 * Extract set numbers from images via AI Vision
 */
async function extractSetNumbers(input: ExtractSetNumbersInput): Promise<ExtractSetNumbersResponse> {
  const response = await fetch('/api/ai/extract-set-numbers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to extract set numbers');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Hook to extract LEGO set numbers from images using AI Vision
 */
export function useExtractSetNumbers() {
  return useMutation({
    mutationFn: (input: ExtractSetNumbersInput) => extractSetNumbers(input),
  });
}
