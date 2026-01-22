'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ParseVintedScreenshotResponse } from '@/lib/ai/prompts/parse-vinted-screenshot';
import type { MonzoMatchResult } from '@/app/api/purchases/match-monzo/route';
import type { DuplicateCheckResult } from '@/app/api/purchases/check-duplicates/route';
import type { ImportResult, ImportSummary } from '@/app/api/purchases/import-vinted/route';
import { purchaseKeys } from './use-purchases';
import { inventoryKeys } from './use-inventory';

// ============================================
// Types
// ============================================

export interface ParseVintedScreenshotInput {
  image: {
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  };
}

export interface MatchMonzoInput {
  purchases: Array<{
    index: number;
    price: number;
    title: string;
  }>;
}

export interface MatchMonzoResponse {
  matches: MonzoMatchResult[];
  summary: {
    total: number;
    matched: number;
    unmatched: number;
  };
}

export interface CheckDuplicatesInput {
  purchases: Array<{
    index: number;
    price: number;
    title: string;
    purchaseDate: string | null;
  }>;
}

export interface CheckDuplicatesResponse {
  results: DuplicateCheckResult[];
  summary: {
    total: number;
    exactDuplicates: number;
    likelyDuplicates: number;
    possibleDuplicates: number;
    clean: number;
  };
}

export interface ImportVintedInput {
  purchases: Array<{
    title: string;
    price: number;
    purchaseDate: string | null;
    vintedStatus: string;
    inventoryItem: {
      setNumber: string;
      itemName: string;
      condition: 'New' | 'Used';
      status: string;
      skipCreation: boolean;
    };
  }>;
}

export interface ImportVintedResponse {
  results: ImportResult[];
  summary: ImportSummary;
}

// ============================================
// API Functions
// ============================================

async function parseVintedScreenshot(
  input: ParseVintedScreenshotInput
): Promise<ParseVintedScreenshotResponse> {
  const response = await fetch('/api/purchases/parse-vinted-screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to parse screenshot');
  }

  const data = await response.json();
  return data.data;
}

async function matchMonzoTransactions(input: MatchMonzoInput): Promise<MatchMonzoResponse> {
  const response = await fetch('/api/purchases/match-monzo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to match transactions');
  }

  const data = await response.json();
  return data.data;
}

async function checkDuplicates(input: CheckDuplicatesInput): Promise<CheckDuplicatesResponse> {
  const response = await fetch('/api/purchases/check-duplicates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to check duplicates');
  }

  const data = await response.json();
  return data.data;
}

async function importVintedPurchases(input: ImportVintedInput): Promise<ImportVintedResponse> {
  const response = await fetch('/api/purchases/import-vinted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import purchases');
  }

  const data = await response.json();
  return data.data;
}

// ============================================
// Hooks
// ============================================

/**
 * Hook to parse a Vinted screenshot using AI
 */
export function useParseVintedScreenshot() {
  return useMutation({
    mutationFn: parseVintedScreenshot,
  });
}

/**
 * Hook to match extracted purchases to Monzo transactions
 */
export function useMatchMonzoTransactions() {
  return useMutation({
    mutationFn: matchMonzoTransactions,
  });
}

/**
 * Hook to check for duplicate purchases
 */
export function useCheckDuplicates() {
  return useMutation({
    mutationFn: checkDuplicates,
  });
}

/**
 * Hook to import Vinted purchases and create inventory items
 */
export function useImportVintedPurchases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: importVintedPurchases,
    onSuccess: () => {
      // Invalidate purchase and inventory lists after import
      queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
    },
  });
}

// ============================================
// Combined Processing Hook
// ============================================

export interface ProcessVintedScreenshotResult {
  purchases: ParseVintedScreenshotResponse['purchases'];
  matches: MonzoMatchResult[];
  duplicates: DuplicateCheckResult[];
}

/**
 * Hook that combines screenshot parsing, Monzo matching, and duplicate checking
 * into a single operation
 */
export function useProcessVintedScreenshot() {
  const parseScreenshot = useParseVintedScreenshot();
  const matchMonzo = useMatchMonzoTransactions();
  const checkDupes = useCheckDuplicates();

  const process = async (
    input: ParseVintedScreenshotInput
  ): Promise<ProcessVintedScreenshotResult> => {
    // Step 1: Parse the screenshot
    const parseResult = await parseScreenshot.mutateAsync(input);

    if (!parseResult.purchases || parseResult.purchases.length === 0) {
      return {
        purchases: [],
        matches: [],
        duplicates: [],
      };
    }

    // Step 2: Match with Monzo transactions
    const matchInput = parseResult.purchases.map((p, index) => ({
      index,
      price: p.price,
      title: p.title,
    }));

    const matchResult = await matchMonzo.mutateAsync({ purchases: matchInput });

    // Step 3: Check for duplicates (with matched dates)
    const duplicateInput = parseResult.purchases.map((p, index) => {
      const match = matchResult.matches.find((m) => m.index === index);
      return {
        index,
        price: p.price,
        title: p.title,
        purchaseDate: match?.purchaseDate || null,
      };
    });

    const duplicateResult = await checkDupes.mutateAsync({ purchases: duplicateInput });

    return {
      purchases: parseResult.purchases,
      matches: matchResult.matches,
      duplicates: duplicateResult.results,
    };
  };

  return {
    process,
    isParsing: parseScreenshot.isPending,
    isMatching: matchMonzo.isPending,
    isCheckingDuplicates: checkDupes.isPending,
    isProcessing: parseScreenshot.isPending || matchMonzo.isPending || checkDupes.isPending,
    error: parseScreenshot.error || matchMonzo.error || checkDupes.error,
    reset: () => {
      parseScreenshot.reset();
      matchMonzo.reset();
      checkDupes.reset();
    },
  };
}
