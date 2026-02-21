/**
 * Hooks for Negotiation Automation functionality
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  NegotiationMetrics,
  NegotiationConfig,
  NegotiationOffer,
  EnrichedEligibleItem,
  ProcessOffersResult,
  NegotiationDiscountRule,
} from '@/lib/ebay/negotiation.types';

/**
 * Query key factory for negotiation
 */
export const negotiationKeys = {
  all: ['negotiation'] as const,
  config: () => [...negotiationKeys.all, 'config'] as const,
  metrics: (days?: number) => [...negotiationKeys.all, 'metrics', days] as const,
  offers: (params?: OffersListParams) => [...negotiationKeys.all, 'offers', params] as const,
  eligible: () => [...negotiationKeys.all, 'eligible'] as const,
  rules: () => [...negotiationKeys.all, 'rules'] as const,
};

interface OffersListParams {
  status?: string;
  triggerType?: 'manual' | 'automated';
  listingId?: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}

// =============================================================================
// API Functions
// =============================================================================

async function fetchConfig(): Promise<NegotiationConfig> {
  const response = await fetch('/api/negotiation/config');
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to fetch config');
  }

  return json.data;
}

async function updateConfig(updates: Partial<NegotiationConfig>): Promise<NegotiationConfig> {
  const response = await fetch('/api/negotiation/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to update config');
  }

  return json.data;
}

async function fetchMetrics(days: number = 30): Promise<NegotiationMetrics> {
  const response = await fetch(`/api/negotiation/metrics?days=${days}`);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to fetch metrics');
  }

  return json.data;
}

interface OffersListResponse {
  offers: NegotiationOffer[];
  total: number;
}

async function fetchOffers(params: OffersListParams = {}): Promise<OffersListResponse> {
  const searchParams = new URLSearchParams();

  if (params.status) searchParams.set('status', params.status);
  if (params.triggerType) searchParams.set('triggerType', params.triggerType);
  if (params.listingId) searchParams.set('listingId', params.listingId);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);

  const response = await fetch(`/api/negotiation/offers?${searchParams.toString()}`);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to fetch offers');
  }

  return { offers: json.data, total: json.total };
}

async function fetchEligibleItems(): Promise<EnrichedEligibleItem[]> {
  const response = await fetch('/api/negotiation/eligible');
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to fetch eligible items');
  }

  return json.data;
}

interface SendOffersParams {
  listingIds?: string[];
  dryRun?: boolean;
}

async function sendOffers(params: SendOffersParams = {}): Promise<ProcessOffersResult> {
  const response = await fetch('/api/negotiation/send-offers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to send offers');
  }

  return json.data;
}

async function fetchRules(): Promise<NegotiationDiscountRule[]> {
  const response = await fetch('/api/negotiation/rules');
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to fetch rules');
  }

  return json.data;
}

async function createRule(
  rule: Omit<NegotiationDiscountRule, 'id' | 'userId'>
): Promise<NegotiationDiscountRule> {
  const response = await fetch('/api/negotiation/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to create rule');
  }

  return json.data;
}

async function updateRule(
  id: string,
  rule: Omit<NegotiationDiscountRule, 'id' | 'userId'>
): Promise<NegotiationDiscountRule> {
  const response = await fetch(`/api/negotiation/rules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Failed to update rule');
  }

  return json.data;
}

async function deleteRule(id: string): Promise<void> {
  const response = await fetch(`/api/negotiation/rules/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const json = await response.json();
    throw new Error(json.error || 'Failed to delete rule');
  }
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook for negotiation configuration
 */
export function useNegotiationConfig() {
  return useQuery({
    queryKey: negotiationKeys.config(),
    queryFn: fetchConfig,
  });
}

/**
 * Hook for updating negotiation configuration
 */
export function useUpdateNegotiationConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: negotiationKeys.config() });
    },
  });
}

/**
 * Hook for negotiation metrics
 */
export function useNegotiationMetrics(days: number = 30) {
  return useQuery({
    queryKey: negotiationKeys.metrics(days),
    queryFn: () => fetchMetrics(days),
  });
}

/**
 * Hook for negotiation offers list
 */
export function useNegotiationOffers(params: OffersListParams = {}) {
  return useQuery({
    queryKey: negotiationKeys.offers(params),
    queryFn: () => fetchOffers(params),
  });
}

/**
 * Hook for eligible items
 */
export function useEligibleItems() {
  return useQuery({
    queryKey: negotiationKeys.eligible(),
    queryFn: fetchEligibleItems,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for sending offers
 */
export function useSendOffers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: sendOffers,
    onSuccess: () => {
      // Invalidate all negotiation data
      queryClient.invalidateQueries({ queryKey: negotiationKeys.all });
    },
  });
}

/**
 * Hook for discount rules
 */
export function useDiscountRules() {
  return useQuery({
    queryKey: negotiationKeys.rules(),
    queryFn: fetchRules,
  });
}

/**
 * Hook for creating a discount rule
 */
export function useCreateDiscountRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: negotiationKeys.rules() });
    },
  });
}

/**
 * Hook for updating a discount rule
 */
export function useUpdateDiscountRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...rule
    }: { id: string } & Omit<NegotiationDiscountRule, 'id' | 'userId'>) => updateRule(id, rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: negotiationKeys.rules() });
    },
  });
}

/**
 * Hook for deleting a discount rule
 */
export function useDeleteDiscountRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: negotiationKeys.rules() });
    },
  });
}
