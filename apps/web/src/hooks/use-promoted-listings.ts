/**
 * eBay Promoted Listings Hooks
 *
 * TanStack Query hooks for managing promoted listings and schedules.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  EbayCampaign,
  EbayAd,
  EbayBulkAdResponseItem,
} from '@/lib/ebay/types';
import type { BulkPromotionResult } from '@/lib/ebay/ebay-promoted-listings.service';

// ============================================================================
// Query Keys
// ============================================================================

export const promotedListingsKeys = {
  all: ['promoted-listings'] as const,
  campaigns: () => [...promotedListingsKeys.all, 'campaigns'] as const,
  status: (listingIds?: string[]) => [...promotedListingsKeys.all, 'status', listingIds] as const,
  allAds: () => [...promotedListingsKeys.all, 'all-ads'] as const,
  schedules: () => [...promotedListingsKeys.all, 'schedules'] as const,
  schedule: (id: string) => [...promotedListingsKeys.all, 'schedule', id] as const,
};

// ============================================================================
// Types
// ============================================================================

interface CampaignAds {
  campaign: EbayCampaign;
  ads: EbayAd[];
}

interface PromotionStatus {
  listingId: string;
  isPromoted: boolean;
  campaignId?: string;
  campaignName?: string;
  bidPercentage?: string;
  adId?: string;
  adStatus?: string;
}

export interface PromotionSchedule {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  enabled: boolean;
  stages: PromotionStage[];
  created_at: string;
  updated_at: string;
}

export interface PromotionStage {
  id?: string;
  days_threshold: number;
  bid_percentage: number;
}

interface SaveScheduleParams {
  campaignId: string;
  campaignName?: string;
  enabled: boolean;
  stages: Array<{ days_threshold: number; bid_percentage: number }>;
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchCampaigns(): Promise<EbayCampaign[]> {
  const response = await fetch('/api/integrations/ebay/promoted-listings/campaigns');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch campaigns');
  }
  const data = await response.json();
  return data.campaigns;
}

async function fetchAllPromotedAds(): Promise<CampaignAds[]> {
  const response = await fetch('/api/integrations/ebay/promoted-listings/status');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch promoted ads');
  }
  const data = await response.json();
  return data.campaignAds;
}

async function fetchPromotionStatus(listingIds: string[]): Promise<PromotionStatus[]> {
  const params = new URLSearchParams({ listingIds: listingIds.join(',') });
  const response = await fetch(`/api/integrations/ebay/promoted-listings/status?${params}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch promotion status');
  }
  const data = await response.json();
  return data.statuses;
}

async function addAds(params: {
  campaignId: string;
  listings: Array<{ listingId: string; bidPercentage: string }>;
}): Promise<BulkPromotionResult> {
  const response = await fetch('/api/integrations/ebay/promoted-listings/ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add promoted listings');
  }
  return response.json();
}

async function updateAdsBid(params: {
  campaignId: string;
  listings: Array<{ listingId: string; bidPercentage: string }>;
}): Promise<BulkPromotionResult> {
  const response = await fetch('/api/integrations/ebay/promoted-listings/ads/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update bid percentages');
  }
  return response.json();
}

async function removeAds(params: {
  campaignId: string;
  listingIds: string[];
}): Promise<BulkPromotionResult> {
  const response = await fetch('/api/integrations/ebay/promoted-listings/ads/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove promoted listings');
  }
  return response.json();
}

async function fetchSchedules(): Promise<PromotionSchedule[]> {
  const response = await fetch('/api/integrations/ebay/promoted-listings/schedules');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch schedules');
  }
  const data = await response.json();
  return data.schedules;
}

async function saveSchedule(params: SaveScheduleParams): Promise<PromotionSchedule> {
  const response = await fetch('/api/integrations/ebay/promoted-listings/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save schedule');
  }
  const data = await response.json();
  return data.schedule;
}

async function deleteSchedule(scheduleId: string): Promise<void> {
  const response = await fetch(`/api/integrations/ebay/promoted-listings/schedules?id=${scheduleId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete schedule');
  }
}

// ============================================================================
// Hooks
// ============================================================================

export function usePromotedCampaigns() {
  return useQuery({
    queryKey: promotedListingsKeys.campaigns(),
    queryFn: fetchCampaigns,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllPromotedAds() {
  return useQuery({
    queryKey: promotedListingsKeys.allAds(),
    queryFn: fetchAllPromotedAds,
    staleTime: 2 * 60 * 1000,
  });
}

export function usePromotionStatus(listingIds: string[]) {
  return useQuery({
    queryKey: promotedListingsKeys.status(listingIds),
    queryFn: () => fetchPromotionStatus(listingIds),
    enabled: listingIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAddPromotedAds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addAds,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotedListingsKeys.all });
    },
  });
}

export function useUpdateAdsBid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAdsBid,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotedListingsKeys.all });
    },
  });
}

export function useRemovePromotedAds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeAds,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotedListingsKeys.all });
    },
  });
}

export function usePromotionSchedules() {
  return useQuery({
    queryKey: promotedListingsKeys.schedules(),
    queryFn: fetchSchedules,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotedListingsKeys.schedules() });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promotedListingsKeys.schedules() });
    },
  });
}
