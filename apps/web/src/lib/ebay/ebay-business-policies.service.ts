/**
 * eBay Business Policies Service
 *
 * Manages caching and retrieval of eBay business policies (fulfillment, payment, return).
 * Policies are cached for 24 hours to reduce API calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import { EbayApiAdapter } from './ebay-api.adapter';
import { EbayAuthService } from './ebay-auth.service';
import type { EbayFulfillmentPolicy, EbayPaymentPolicy, EbayReturnPolicy } from './types';
import type {
  EbayBusinessPolicy,
  PolicyType,
  BusinessPoliciesResponse,
} from './listing-creation.types';

// Cache TTL in milliseconds (24 hours)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Service for managing eBay business policies
 */
export class EbayBusinessPoliciesService {
  private supabase: SupabaseClient<Database>;
  private userId: string;
  private authService: EbayAuthService;

  constructor(supabase: SupabaseClient<Database>, userId: string, authService?: EbayAuthService) {
    this.supabase = supabase;
    this.userId = userId;
    this.authService = authService ?? new EbayAuthService();
  }

  /**
   * Get all business policies (from cache or eBay API)
   *
   * @param forceRefresh - If true, bypass cache and fetch from eBay
   * @returns Business policies with defaults identified
   */
  async getPolicies(forceRefresh = false): Promise<BusinessPoliciesResponse> {
    if (!forceRefresh) {
      // Try to get from cache first
      const cached = await this.getCachedPolicies();
      if (cached) {
        console.log('[EbayBusinessPoliciesService] Returning cached policies');
        return cached;
      }
    }

    // Fetch fresh policies from eBay
    console.log('[EbayBusinessPoliciesService] Fetching fresh policies from eBay');
    return this.refreshPolicies();
  }

  /**
   * Force refresh policies from eBay API
   */
  async refreshPolicies(): Promise<BusinessPoliciesResponse> {
    // Get access token
    const accessToken = await this.authService.getAccessToken(this.userId);
    if (!accessToken) {
      throw new Error('No valid eBay access token. Please reconnect your eBay account.');
    }

    // Create API adapter
    const adapter = new EbayApiAdapter({
      accessToken,
      marketplaceId: 'EBAY_GB',
      userId: this.userId,
    });

    // Fetch all policy types in parallel
    const [fulfillmentResponse, paymentResponse, returnResponse] = await Promise.all([
      adapter.getFulfillmentPolicies(),
      adapter.getPaymentPolicies(),
      adapter.getReturnPolicies(),
    ]);

    // Transform and cache policies
    const fulfillmentPolicies = await this.transformAndCacheFulfillmentPolicies(
      fulfillmentResponse.fulfillmentPolicies
    );
    const paymentPolicies = await this.transformAndCachePaymentPolicies(
      paymentResponse.paymentPolicies
    );
    const returnPolicies = await this.transformAndCacheReturnPolicies(
      returnResponse.returnPolicies
    );

    // Identify defaults
    const defaults = this.identifyDefaults(fulfillmentPolicies, paymentPolicies, returnPolicies);

    return {
      fulfillment: fulfillmentPolicies,
      payment: paymentPolicies,
      return: returnPolicies,
      defaults,
    };
  }

  /**
   * Get the default shipping policy (prioritizes "small parcel" style policies)
   */
  async getDefaultShippingPolicy(): Promise<EbayBusinessPolicy | null> {
    const policies = await this.getPolicies();

    // First, look for explicitly default policy
    const defaultPolicy = policies.fulfillment.find((p) => p.isDefault);
    if (defaultPolicy) {
      return defaultPolicy;
    }

    // Otherwise, try to find a "small parcel" style policy
    const smallParcelPolicy = policies.fulfillment.find(
      (p) =>
        p.name.toLowerCase().includes('small') ||
        p.name.toLowerCase().includes('parcel') ||
        p.name.toLowerCase().includes('royal mail')
    );

    return smallParcelPolicy || policies.fulfillment[0] || null;
  }

  /**
   * Get cached policies from database
   */
  private async getCachedPolicies(): Promise<BusinessPoliciesResponse | null> {
    const cutoffTime = new Date(Date.now() - CACHE_TTL_MS).toISOString();

    const { data: cached, error } = await this.supabase
      .from('ebay_business_policies')
      .select('*')
      .eq('user_id', this.userId)
      .gte('cached_at', cutoffTime);

    if (error) {
      console.error('[EbayBusinessPoliciesService] Error fetching cached policies:', error);
      return null;
    }

    if (!cached || cached.length === 0) {
      return null;
    }

    // Group by policy type
    const fulfillment: EbayBusinessPolicy[] = [];
    const payment: EbayBusinessPolicy[] = [];
    const returnPolicies: EbayBusinessPolicy[] = [];

    for (const policy of cached) {
      const transformed: EbayBusinessPolicy = {
        id: policy.policy_id,
        type: policy.policy_type as PolicyType,
        name: policy.policy_name,
        isDefault: policy.is_default ?? false,
        data: policy.policy_data as Record<string, unknown>,
        cachedAt: policy.cached_at ?? new Date().toISOString(),
      };

      switch (policy.policy_type) {
        case 'fulfillment':
          fulfillment.push(transformed);
          break;
        case 'payment':
          payment.push(transformed);
          break;
        case 'return':
          returnPolicies.push(transformed);
          break;
      }
    }

    // Only return cached if we have at least one of each type
    if (fulfillment.length === 0 || payment.length === 0 || returnPolicies.length === 0) {
      return null;
    }

    const defaults = this.identifyDefaults(fulfillment, payment, returnPolicies);

    return {
      fulfillment,
      payment,
      return: returnPolicies,
      defaults,
    };
  }

  /**
   * Transform and cache fulfillment policies
   */
  private async transformAndCacheFulfillmentPolicies(
    policies: EbayFulfillmentPolicy[]
  ): Promise<EbayBusinessPolicy[]> {
    const transformed: EbayBusinessPolicy[] = [];
    const now = new Date().toISOString();

    for (const policy of policies) {
      const isDefault = policy.categoryTypes?.some((ct) => ct.default) ?? false;

      const ebayPolicy: EbayBusinessPolicy = {
        id: policy.fulfillmentPolicyId,
        type: 'fulfillment',
        name: policy.name,
        isDefault,
        data: policy as unknown as Record<string, unknown>,
        cachedAt: now,
      };

      transformed.push(ebayPolicy);

      // Upsert to cache
      await this.supabase.from('ebay_business_policies').upsert(
        {
          user_id: this.userId,
          policy_type: 'fulfillment',
          policy_id: policy.fulfillmentPolicyId,
          policy_name: policy.name,
          policy_data: policy as unknown as Json,
          is_default: isDefault,
          cached_at: now,
        },
        {
          onConflict: 'user_id,policy_type,policy_id',
        }
      );
    }

    return transformed;
  }

  /**
   * Transform and cache payment policies
   */
  private async transformAndCachePaymentPolicies(
    policies: EbayPaymentPolicy[]
  ): Promise<EbayBusinessPolicy[]> {
    const transformed: EbayBusinessPolicy[] = [];
    const now = new Date().toISOString();

    for (const policy of policies) {
      const isDefault = policy.categoryTypes?.some((ct) => ct.default) ?? false;

      const ebayPolicy: EbayBusinessPolicy = {
        id: policy.paymentPolicyId,
        type: 'payment',
        name: policy.name,
        isDefault,
        data: policy as unknown as Record<string, unknown>,
        cachedAt: now,
      };

      transformed.push(ebayPolicy);

      // Upsert to cache
      await this.supabase.from('ebay_business_policies').upsert(
        {
          user_id: this.userId,
          policy_type: 'payment',
          policy_id: policy.paymentPolicyId,
          policy_name: policy.name,
          policy_data: policy as unknown as Json,
          is_default: isDefault,
          cached_at: now,
        },
        {
          onConflict: 'user_id,policy_type,policy_id',
        }
      );
    }

    return transformed;
  }

  /**
   * Transform and cache return policies
   */
  private async transformAndCacheReturnPolicies(
    policies: EbayReturnPolicy[]
  ): Promise<EbayBusinessPolicy[]> {
    const transformed: EbayBusinessPolicy[] = [];
    const now = new Date().toISOString();

    for (const policy of policies) {
      const isDefault = policy.categoryTypes?.some((ct) => ct.default) ?? false;

      const ebayPolicy: EbayBusinessPolicy = {
        id: policy.returnPolicyId,
        type: 'return',
        name: policy.name,
        isDefault,
        data: policy as unknown as Record<string, unknown>,
        cachedAt: now,
      };

      transformed.push(ebayPolicy);

      // Upsert to cache
      await this.supabase.from('ebay_business_policies').upsert(
        {
          user_id: this.userId,
          policy_type: 'return',
          policy_id: policy.returnPolicyId,
          policy_name: policy.name,
          policy_data: policy as unknown as Json,
          is_default: isDefault,
          cached_at: now,
        },
        {
          onConflict: 'user_id,policy_type,policy_id',
        }
      );
    }

    return transformed;
  }

  /**
   * Identify default policies
   */
  private identifyDefaults(
    fulfillment: EbayBusinessPolicy[],
    payment: EbayBusinessPolicy[],
    returnPolicies: EbayBusinessPolicy[]
  ): BusinessPoliciesResponse['defaults'] {
    // Find defaults or fallback to first
    const defaultFulfillment = fulfillment.find((p) => p.isDefault) || fulfillment[0];
    const defaultPayment = payment.find((p) => p.isDefault) || payment[0];

    // For return policies, prefer policies with returns accepted (many categories require this)
    // First check for explicitly default, then for one with returns accepted, then first available
    type ReturnPolicyData = { returnsAccepted?: boolean };
    const defaultReturn =
      returnPolicies.find((p) => p.isDefault) ||
      returnPolicies.find((p) => (p.data as ReturnPolicyData)?.returnsAccepted === true) ||
      returnPolicies[0];

    return {
      fulfillmentPolicyId: defaultFulfillment?.id,
      paymentPolicyId: defaultPayment?.id,
      returnPolicyId: defaultReturn?.id,
    };
  }

  /**
   * Clear cached policies for this user
   */
  async clearCache(): Promise<void> {
    const { error } = await this.supabase
      .from('ebay_business_policies')
      .delete()
      .eq('user_id', this.userId);

    if (error) {
      console.error('[EbayBusinessPoliciesService] Error clearing cache:', error);
      throw error;
    }
  }
}
