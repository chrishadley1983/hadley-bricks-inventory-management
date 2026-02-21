/**
 * Hook for enriching eligible listings with views data
 *
 * Calls GetItem API for each listing to fetch HitCount (views).
 * Uses SSE for progress updates.
 */

import { useState, useCallback, useRef } from 'react';
import type {
  EligibleListing,
  ViewsEnrichmentProgress,
  ViewsEnrichmentSSEEvent,
} from '@/lib/ebay/listing-refresh.types';

interface UseEnrichViewsResult {
  enrichedListings: EligibleListing[] | null;
  progress: ViewsEnrichmentProgress | null;
  isEnriching: boolean;
  error: string | null;
  enrich: (listings: EligibleListing[]) => Promise<EligibleListing[]>;
  reset: () => void;
}

/**
 * Hook to enrich eligible listings with views data via GetItem calls
 */
export function useEnrichViews(): UseEnrichViewsResult {
  const [enrichedListings, setEnrichedListings] = useState<EligibleListing[] | null>(null);
  const [progress, setProgress] = useState<ViewsEnrichmentProgress | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const enrich = useCallback(async (listings: EligibleListing[]): Promise<EligibleListing[]> => {
    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setIsEnriching(true);
    setError(null);
    setProgress(null);
    setEnrichedListings(null);

    return new Promise((resolve, reject) => {
      fetch('/api/ebay/listing-refresh/eligible/enrich', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ listings }),
        signal: abortControllerRef.current?.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          if (!response.body) {
            throw new Error('No response body');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const processStream = async () => {
            let resolved = false;

            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                // If stream ended but we never got a complete event, reject
                if (!resolved) {
                  setIsEnriching(false);
                  reject(new Error('Stream ended without completion'));
                }
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const event: ViewsEnrichmentSSEEvent = JSON.parse(line.slice(6));

                    if (event.type === 'progress' && event.data && 'current' in event.data) {
                      setProgress(event.data);
                    } else if (
                      event.type === 'complete' &&
                      event.data &&
                      'listings' in event.data
                    ) {
                      // Convert date strings back to Date objects
                      const result = event.data.listings.map((listing) => ({
                        ...listing,
                        listingStartDate: new Date(listing.listingStartDate),
                      }));
                      setEnrichedListings(result);
                      setIsEnriching(false);
                      resolved = true;
                      resolve(result);
                    } else if (event.type === 'error') {
                      const errorMsg = event.error || 'Unknown error';
                      setError(errorMsg);
                      setIsEnriching(false);
                      resolved = true;
                      reject(new Error(errorMsg));
                    }
                  } catch (parseError) {
                    console.warn('[useEnrichViews] Failed to parse event:', line, parseError);
                  }
                }
              }
            }
          };

          processStream().catch((err) => {
            if (err.name !== 'AbortError') {
              setError(err.message);
              setIsEnriching(false);
              reject(err);
            }
          });
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setError(err.message);
            setIsEnriching(false);
            reject(err);
          }
        });
    });
  }, []);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setEnrichedListings(null);
    setProgress(null);
    setIsEnriching(false);
    setError(null);
  }, []);

  return {
    enrichedListings,
    progress,
    isEnriching,
    error,
    enrich,
    reset,
  };
}
