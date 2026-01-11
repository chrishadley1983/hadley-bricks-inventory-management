/**
 * ASIN to BrickLink Mapping Service
 *
 * Handles automatic and manual mapping of Amazon ASINs to BrickLink set numbers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { BrickLinkClient, BrickLinkApiError } from '../bricklink/client';
import type { BrickLinkCredentials } from '../bricklink/types';
import { CredentialsRepository } from '../repositories';
import type { MatchConfidence, SetNumberExtraction, MappingValidation } from './types';
import { normalizeSetNumber } from './bricklink-url';

/**
 * Regex patterns for extracting set numbers from product titles
 */
const SET_NUMBER_PATTERNS = [
  // Standard format: 40585-1
  { pattern: /(\d{4,6}-\d)/, confidence: 'exact' as MatchConfidence, method: 'standard_format' },
  // LEGO prefix with number: LEGO 40585
  { pattern: /LEGO\s+(\d{4,6})/i, confidence: 'exact' as MatchConfidence, method: 'lego_prefix' },
  // Set prefix: Set 40585
  { pattern: /\bSet\s+(\d{4,6})/i, confidence: 'exact' as MatchConfidence, method: 'set_prefix' },
  // Number in parentheses: (40585)
  { pattern: /\((\d{4,6})\)/, confidence: 'probable' as MatchConfidence, method: 'parentheses' },
  // Standalone 5-digit number
  { pattern: /\b(\d{5})\b/, confidence: 'probable' as MatchConfidence, method: 'standalone_number' },
];

/**
 * Service for mapping ASINs to BrickLink set numbers
 */
export class MappingService {
  private credentialsRepo: CredentialsRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get BrickLink client for a user
   */
  private async getBricklinkClient(userId: string): Promise<BrickLinkClient> {
    const credentials = await this.credentialsRepo.getCredentials<BrickLinkCredentials>(
      userId,
      'bricklink'
    );

    if (!credentials) {
      throw new Error('BrickLink credentials not configured');
    }

    return new BrickLinkClient(credentials);
  }

  /**
   * Extract potential set number from product title
   */
  extractSetNumber(title: string | null): SetNumberExtraction {
    if (!title) {
      return { setNumber: null, confidence: null, method: null };
    }

    for (const { pattern, confidence, method } of SET_NUMBER_PATTERNS) {
      const match = title.match(pattern);
      if (match) {
        const rawNumber = match[1];
        // Normalize: ensure -1 suffix if missing
        const setNumber = rawNumber.includes('-') ? rawNumber : `${rawNumber}-1`;
        return { setNumber, confidence, method };
      }
    }

    return { setNumber: null, confidence: null, method: null };
  }

  /**
   * Validate a set number exists in BrickLink catalog
   */
  async validateSetNumber(userId: string, setNumber: string): Promise<MappingValidation> {
    const normalized = normalizeSetNumber(setNumber);

    if (!normalized) {
      return {
        valid: false,
        setNumber,
        error: 'Invalid set number format',
      };
    }

    try {
      const client = await this.getBricklinkClient(userId);
      const catalogItem = await client.getCatalogItem('SET', normalized);

      return {
        valid: true,
        setNumber: normalized,
        setName: catalogItem.name,
      };
    } catch (error) {
      if (error instanceof BrickLinkApiError && error.code === 404) {
        return {
          valid: false,
          setNumber: normalized,
          error: 'Set not found in BrickLink catalog',
        };
      }
      throw error;
    }
  }

  /**
   * Map a single ASIN to BrickLink set number
   */
  async mapAsin(
    userId: string,
    asin: string,
    productTitle: string | null
  ): Promise<{ mapped: boolean; setNumber: string | null; confidence: MatchConfidence | null }> {
    // Extract potential set number from title
    const extraction = this.extractSetNumber(productTitle);

    if (!extraction.setNumber) {
      console.log(`[MappingService.mapAsin] No set number extracted from title for ASIN ${asin}`);
      return { mapped: false, setNumber: null, confidence: null };
    }

    // Validate the set exists in BrickLink
    const validation = await this.validateSetNumber(userId, extraction.setNumber);

    if (!validation.valid) {
      console.log(`[MappingService.mapAsin] Set ${extraction.setNumber} not found in BrickLink for ASIN ${asin}`);
      return { mapped: false, setNumber: extraction.setNumber, confidence: null };
    }

    // Create the mapping
    const { error } = await this.supabase
      .from('asin_bricklink_mapping')
      .upsert({
        asin,
        user_id: userId,
        bricklink_set_number: validation.setNumber,
        match_confidence: extraction.confidence ?? 'unknown',
        match_method: extraction.method,
        verified_at: extraction.confidence === 'exact' ? new Date().toISOString() : null,
      });

    if (error) {
      console.error('[MappingService.mapAsin] Error creating mapping:', error);
      throw new Error(`Failed to create mapping: ${error.message}`);
    }

    console.log(`[MappingService.mapAsin] Mapped ASIN ${asin} to ${validation.setNumber} (${extraction.confidence})`);
    return { mapped: true, setNumber: validation.setNumber, confidence: extraction.confidence };
  }

  /**
   * Map all unmapped ASINs for a user
   */
  async mapAllUnmapped(
    userId: string,
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ mapped: number; failed: number; total: number }> {
    // Get all active ASINs
    const { data: allAsins, error: asinsError } = await this.supabase
      .from('tracked_asins')
      .select('asin, name')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (asinsError) {
      console.error('[MappingService.mapAllUnmapped] Error fetching ASINs:', asinsError);
      throw new Error(`Failed to fetch ASINs: ${asinsError.message}`);
    }

    // Get all existing mappings
    const { data: mappings, error: mappingsError } = await this.supabase
      .from('asin_bricklink_mapping')
      .select('asin')
      .eq('user_id', userId);

    if (mappingsError) {
      console.error('[MappingService.mapAllUnmapped] Error fetching mappings:', mappingsError);
      throw new Error(`Failed to fetch mappings: ${mappingsError.message}`);
    }

    // Filter to get only unmapped ASINs
    const mappedAsins = new Set(mappings?.map((m) => m.asin) ?? []);
    const unmapped = (allAsins ?? []).filter((a) => !mappedAsins.has(a.asin));

    console.log(`[MappingService.mapAllUnmapped] Found ${unmapped.length} unmapped ASINs out of ${allAsins?.length ?? 0} total`);

    const total = unmapped?.length ?? 0;
    let mapped = 0;
    let failed = 0;

    for (let i = 0; i < total; i++) {
      const item = unmapped![i];
      try {
        const result = await this.mapAsin(userId, item.asin, item.name);
        if (result.mapped) {
          mapped++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`[MappingService.mapAllUnmapped] Error mapping ${item.asin}:`, err);
        failed++;
      }

      // Rate limit: 200ms between BrickLink API calls
      await this.delay(200);

      // Report progress
      onProgress?.(i + 1, total);
    }

    return { mapped, failed, total };
  }

  /**
   * Get mapping for an ASIN
   */
  async getMapping(userId: string, asin: string): Promise<{
    bricklinkSetNumber: string;
    matchConfidence: MatchConfidence;
    matchMethod: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('asin_bricklink_mapping')
      .select('bricklink_set_number, match_confidence, match_method')
      .eq('user_id', userId)
      .eq('asin', asin)
      .maybeSingle();

    if (error) {
      console.error('[MappingService.getMapping] Error:', error);
      throw new Error(`Failed to get mapping: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return {
      bricklinkSetNumber: data.bricklink_set_number,
      matchConfidence: data.match_confidence as MatchConfidence,
      matchMethod: data.match_method,
    };
  }

  /**
   * Delete a mapping
   */
  async deleteMapping(userId: string, asin: string): Promise<void> {
    const { error } = await this.supabase
      .from('asin_bricklink_mapping')
      .delete()
      .eq('user_id', userId)
      .eq('asin', asin);

    if (error) {
      console.error('[MappingService.deleteMapping] Error:', error);
      throw new Error(`Failed to delete mapping: ${error.message}`);
    }
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
