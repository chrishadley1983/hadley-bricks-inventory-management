'use client';

import { useMutation } from '@tanstack/react-query';
import type { ParsedInventoryResponse } from '@/lib/ai';

/**
 * Parse inventory description via AI
 */
async function parseInventory(text: string): Promise<ParsedInventoryResponse> {
  const response = await fetch('/api/ai/parse-inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to parse inventory');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Hook to parse inventory description using AI
 */
export function useParseInventory() {
  return useMutation({
    mutationFn: (text: string) => parseInventory(text),
  });
}
