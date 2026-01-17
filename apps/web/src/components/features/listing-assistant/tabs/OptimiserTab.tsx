'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Link2Off } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  OptimiserFilters,
  OptimiserTable,
  AnalysisPanel,
} from '@/components/features/listing-optimiser';
import type {
  OptimiserFilters as FilterType,
  OptimiserListing,
  FullAnalysisResult,
  ListingSuggestion,
} from '@/components/features/listing-optimiser/types';
import {
  useListingOptimiserListings,
  useAnalyseListings,
  useApplySuggestion,
} from '@/hooks/useListingOptimiser';

export function OptimiserTab() {
  const { toast } = useToast();

  // Filters state
  const [filters, setFilters] = useState<FilterType>({});

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Analysis panel state
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<FullAnalysisResult | null>(null);
  const [previousScore, setPreviousScore] = useState<number | null>(null);
  const [currentListingId, setCurrentListingId] = useState<string | null>(null);

  // Queries and mutations
  const { data, isLoading, error, refetch } = useListingOptimiserListings(filters);
  const analyseMutation = useAnalyseListings();
  const applyMutation = useApplySuggestion();

  // Handle analyse
  const handleAnalyse = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast({ title: 'Error', description: 'Select at least one listing', variant: 'destructive' });
      return;
    }

    const itemIds = Array.from(selectedIds);

    try {
      const result = await analyseMutation.mutateAsync(itemIds);

      // If we analysed a single listing, show the panel
      if (result.results.length === 1) {
        const analysisResult = result.results[0];
        // Get previous score from listing data
        const listing = data?.listings.find((l) => l.itemId === analysisResult.listingId);
        setPreviousScore(listing?.qualityScore ?? null);
        setCurrentAnalysis(analysisResult);
        setCurrentListingId(analysisResult.listingId);
        setIsPanelOpen(true);
      }

      // Clear selection after analysis
      setSelectedIds(new Set());
    } catch {
      // Error is handled by mutation
    }
  }, [selectedIds, analyseMutation, data?.listings, toast]);

  // Handle row click - show latest analysis
  const handleRowClick = useCallback(
    async (listing: OptimiserListing) => {
      if (listing.qualityScore !== null) {
        // Listing has been reviewed, fetch and show the analysis
        try {
          const response = await fetch(`/api/listing-optimiser/${listing.itemId}`);
          const json = await response.json();

          if (response.ok && json.data) {
            setCurrentAnalysis({
              listingId: listing.itemId,
              analysis: json.data.analysis,
              pricing: json.data.pricing,
              reviewId: json.data.id,
            });
            setPreviousScore(listing.qualityScore);
            setCurrentListingId(listing.itemId);
            setIsPanelOpen(true);
          }
        } catch {
          toast({ title: 'Error', description: 'Failed to load analysis', variant: 'destructive' });
        }
      } else {
        // Not reviewed yet, select and analyse
        setSelectedIds(new Set([listing.itemId]));
        toast({ title: 'Tip', description: 'Click "Analyse" to review this listing' });
      }
    },
    [toast]
  );

  // Handle approve suggestion
  const handleApprove = useCallback(
    async (suggestion: ListingSuggestion) => {
      if (!currentListingId) return;

      try {
        await applyMutation.mutateAsync({
          itemId: currentListingId,
          suggestion,
        });

        // Re-analyse after change to update scores
        const result = await analyseMutation.mutateAsync([currentListingId]);
        if (result.results.length > 0) {
          setCurrentAnalysis(result.results[0]);
        }
      } catch {
        // Error handled by mutation
      }
    },
    [currentListingId, applyMutation, analyseMutation]
  );

  // Handle skip suggestion
  const handleSkip = useCallback((_suggestion: ListingSuggestion) => {
    // Just move to next suggestion - no action needed
    toast({ title: 'Skipped', description: 'Suggestion skipped' });
  }, [toast]);

  // Handle panel close
  const handlePanelClose = useCallback(() => {
    setIsPanelOpen(false);
    setCurrentAnalysis(null);
    setCurrentListingId(null);
    setPreviousScore(null);
    refetch();
  }, [refetch]);

  // Check for eBay connection error
  if (error && error.message.includes('EBAY_NOT_CONNECTED')) {
    return (
      <div className="p-6">
        <Alert>
          <Link2Off className="h-4 w-4" />
          <AlertTitle>eBay Connection Required</AlertTitle>
          <AlertDescription className="mt-2">
            <p>Connect your eBay account to use the Listing Optimiser.</p>
            <Button variant="outline" className="mt-3" asChild>
              <a href="/settings/integrations">Connect eBay</a>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="text-sm text-muted-foreground">
        Review and optimize your eBay listings to improve quality scores and visibility.
        Select listings and click Analyse to get AI-powered improvement suggestions.
      </div>

      {/* Filters and summary */}
      <OptimiserFilters
        filters={filters}
        onFiltersChange={setFilters}
        summary={data?.summary}
        selectedCount={selectedIds.size}
        onAnalyse={handleAnalyse}
        isAnalysing={analyseMutation.isPending}
      />

      {/* Listings table */}
      <OptimiserTable
        listings={data?.listings || []}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onRowClick={handleRowClick}
      />

      {/* Analysis panel */}
      <AnalysisPanel
        result={currentAnalysis}
        isOpen={isPanelOpen}
        onClose={handlePanelClose}
        onApprove={handleApprove}
        onSkip={handleSkip}
        isApplying={applyMutation.isPending}
        previousScore={previousScore}
      />
    </div>
  );
}
