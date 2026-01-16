/**
 * useQualityReview Hook
 *
 * Polls the quality review status endpoint and returns the review results.
 * Used by QualityReviewPopup to display review progress and results.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { QualityReviewResult } from '@/lib/ebay/listing-creation.types';

export type QualityReviewStatus = 'idle' | 'pending' | 'completed' | 'failed';

interface QualityReviewResponse {
  status: 'pending' | 'completed' | 'failed';
  review?: QualityReviewResult;
  error?: string;
}

interface UseQualityReviewResult {
  status: QualityReviewStatus;
  review: QualityReviewResult | null;
  error: string | null;
  isLoading: boolean;
  retry: () => void;
}

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
const MAX_POLL_ATTEMPTS = 60; // Maximum ~2 minutes of polling

export function useQualityReview(auditId: string | null): UseQualityReviewResult {
  const [status, setStatus] = useState<QualityReviewStatus>('idle');
  const [review, setReview] = useState<QualityReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollCountRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchReviewStatus = useCallback(async () => {
    if (!auditId) return;

    try {
      const response = await fetch(`/api/ebay/listing/${auditId}/quality-review`);
      const data: QualityReviewResponse = await response.json();

      if (data.status === 'completed' && data.review) {
        setStatus('completed');
        setReview(data.review);
        setError(null);
        // Stop polling
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else if (data.status === 'failed') {
        setStatus('failed');
        setError(data.error || 'Quality review failed');
        // Stop polling
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Still pending
        setStatus('pending');
        pollCountRef.current += 1;

        // Check if we've exceeded max attempts
        if (pollCountRef.current >= MAX_POLL_ATTEMPTS) {
          setStatus('failed');
          setError('Quality review timed out');
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      }
    } catch (err) {
      console.error('[useQualityReview] Fetch error:', err);
      // Don't fail immediately on network errors, keep trying
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_POLL_ATTEMPTS) {
        setStatus('failed');
        setError('Failed to fetch quality review status');
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }
  }, [auditId]);

  const startPolling = useCallback(() => {
    // Reset state
    pollCountRef.current = 0;
    setStatus('pending');
    setReview(null);
    setError(null);

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Initial fetch
    fetchReviewStatus();

    // Start polling
    intervalRef.current = setInterval(fetchReviewStatus, POLL_INTERVAL_MS);
  }, [fetchReviewStatus]);

  const retry = useCallback(() => {
    startPolling();
  }, [startPolling]);

  // Start polling when auditId changes
  useEffect(() => {
    if (auditId) {
      startPolling();
    } else {
      setStatus('idle');
      setReview(null);
      setError(null);
    }

    // Cleanup on unmount or auditId change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [auditId, startPolling]);

  return {
    status,
    review,
    error,
    isLoading: status === 'pending',
    retry,
  };
}
