'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useToast } from '@/hooks/use-toast';
import { usePerfPage } from '@/hooks/use-perf';
import { Link2Off } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  OptimiserFilters,
  OptimiserTable,
  AnalysisPanel,
} from '@/components/features/listing-optimiser';
import { OffersTab } from '@/components/features/negotiation';
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

// Dynamic import for Header
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

export default function ListingOptimiserPage() {
  usePerfPage('ListingOptimiserPage');
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
  const hasApprovedAnyRef = useRef(false); // Ref to track if any suggestions were approved (ref avoids stale closures)
  const [pendingReanalyse, setPendingReanalyse] = useState(false); // Track if we need to re-analyse after apply completes

  // Queries and mutations
  const { data, isLoading, error, refetch } = useListingOptimiserListings(filters);
  const analyseMutation = useAnalyseListings();
  const applyMutation = useApplySuggestion();

  // Effect to trigger re-analysis when apply completes and we have a pending re-analyse
  useEffect(() => {
    if (pendingReanalyse && !applyMutation.isPending && currentListingId) {
      console.log('[ListingOptimiser] Apply completed, triggering pending re-analysis');
      setPendingReanalyse(false);

      // Trigger re-analysis
      analyseMutation.mutateAsync([currentListingId]).then((result) => {
        if (result.results.length > 0) {
          const newAnalysis = result.results[0];

          setCurrentAnalysis((prev) => {
            if (prev) {
              setPreviousScore(prev.analysis.score);
            }
            return { ...newAnalysis };
          });

          toast({
            title: 'Re-analysed',
            description: `New score: ${newAnalysis.analysis.score}/100 (${newAnalysis.analysis.grade})`,
          });
        }
      }).catch(() => {
        // Error handled by mutation
      });
    }
  }, [pendingReanalyse, applyMutation.isPending, currentListingId, analyseMutation, toast]);

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

  // Handle approve suggestion - apply change but don't re-analyse yet (wait until all reviewed)
  const handleApprove = useCallback(
    async (suggestion: ListingSuggestion) => {
      if (!currentListingId) return;

      // IMPORTANT: Mark approval BEFORE the async call starts
      // This ensures the ref is set when onAllReviewed is triggered by the panel
      // (which happens synchronously after onApprove is called, not after it completes)
      hasApprovedAnyRef.current = true;

      try {
        // Apply the change to eBay
        await applyMutation.mutateAsync({
          itemId: currentListingId,
          suggestion,
        });

        // Show success toast
        toast({
          title: 'Applied',
          description: `${suggestion.field} updated on eBay`,
        });
      } catch (error) {
        // Show error to user with more prominent notification
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ListingOptimiser] Apply failed:', errorMessage);

        toast({
          title: 'Failed to apply change',
          description: errorMessage,
          variant: 'destructive',
          duration: 10000, // Show for 10 seconds for important errors
        });

        // Note: We intentionally do NOT reset hasApprovedAnyRef here
        // because a failed apply still means the user wanted to approve something
        // and re-analysis might still be useful to see updated state
      }
    },
    [currentListingId, applyMutation, toast]
  );

  // Handle skip suggestion
  const handleSkip = useCallback((_suggestion: ListingSuggestion) => {
    // Just move to next suggestion - no action needed
    toast({ title: 'Skipped', description: 'Suggestion skipped' });
  }, [toast]);

  // Handle re-analyse (from "Re-analyse" button after all suggestions reviewed)
  const handleReanalyse = useCallback(async () => {
    if (!currentListingId) return;

    try {
      const result = await analyseMutation.mutateAsync([currentListingId]);
      if (result.results.length > 0) {
        const newAnalysis = result.results[0];

        // Use functional update to capture the current score before updating
        setCurrentAnalysis((prev) => {
          if (prev) {
            setPreviousScore(prev.analysis.score);
          }
          // Spread to create new reference and ensure re-render
          return { ...newAnalysis };
        });

        toast({
          title: 'Re-analysed',
          description: `Score: ${newAnalysis.analysis.score}/100 (${newAnalysis.analysis.grade})`,
        });
      }
    } catch {
      // Error handled by mutation
    }
  }, [currentListingId, analyseMutation, toast]);

  // Handle all suggestions reviewed - auto re-analyse if any were approved
  const handleAllReviewed = useCallback(async () => {
    // Use ref to get current value (avoids stale closure)
    if (!currentListingId || !hasApprovedAnyRef.current) {
      console.log('[ListingOptimiser] All reviewed but no approvals - skipping re-analysis');
      return;
    }

    // If apply is still pending, mark that we need to re-analyse when it completes
    if (applyMutation.isPending) {
      console.log('[ListingOptimiser] Apply still pending - will re-analyse when complete');
      setPendingReanalyse(true);
      return;
    }

    console.log('[ListingOptimiser] All reviewed with approvals - starting re-analysis');

    try {
      const result = await analyseMutation.mutateAsync([currentListingId]);
      if (result.results.length > 0) {
        const newAnalysis = result.results[0];

        // Use functional update to capture the current score before updating
        setCurrentAnalysis((prev) => {
          if (prev) {
            setPreviousScore(prev.analysis.score);
          }
          return { ...newAnalysis };
        });

        toast({
          title: 'Re-analysed',
          description: `New score: ${newAnalysis.analysis.score}/100 (${newAnalysis.analysis.grade})`,
        });
      }
    } catch {
      // Error handled by mutation
    }
  }, [currentListingId, applyMutation.isPending, analyseMutation, toast]);

  // Handle panel close
  const handlePanelClose = useCallback(() => {
    setIsPanelOpen(false);
    setCurrentAnalysis(null);
    setCurrentListingId(null);
    setPreviousScore(null);
    hasApprovedAnyRef.current = false; // Reset for next session
    setPendingReanalyse(false); // Cancel any pending re-analysis
    refetch();
  }, [refetch]);

  // Check for eBay connection error
  if (error && error.message.includes('EBAY_NOT_CONNECTED')) {
    return (
      <>
        <Header title="Listing Optimiser" />
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
      </>
    );
  }

  return (
    <>
      <Header title="Listing Optimiser" />
      <div className="p-6 space-y-6">
        <Tabs defaultValue="optimiser" className="w-full">
          <TabsList>
            <TabsTrigger value="optimiser">Optimiser</TabsTrigger>
            <TabsTrigger value="offers" data-testid="negotiation-tab">Offers</TabsTrigger>
          </TabsList>

          <TabsContent value="optimiser" className="mt-6 space-y-6">
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
              onReanalyse={handleReanalyse}
              onAllReviewed={handleAllReviewed}
              isApplying={applyMutation.isPending}
              isReanalysing={analyseMutation.isPending}
              previousScore={previousScore}
            />
          </TabsContent>

          <TabsContent value="offers" className="mt-6">
            <OffersTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
