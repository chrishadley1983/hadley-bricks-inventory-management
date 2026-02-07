/**
 * Investment Classification Service
 *
 * Auto-classifies LEGO sets for investment analysis:
 * - is_licensed: Licensed theme (Star Wars, Marvel, etc.)
 * - is_ucs: Ultimate Collector Series
 * - is_modular: Modular Building
 * - exclusivity_tier: standard, lego_exclusive, retailer_exclusive, event_exclusive
 *
 * Supports manual overrides via classification_override JSONB column.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const LICENSED_THEMES = [
  'Star Wars',
  'Marvel',
  'Marvel Super Heroes',
  'DC',
  'DC Comics Super Heroes',
  'DC Super Heroes',
  'Harry Potter',
  'Lord of the Rings',
  'The Hobbit',
  'Jurassic World',
  'Jurassic Park',
  'Disney',
  'Disney Princess',
  'Minecraft',
  'Speed Champions',
  'Batman',
  'Super Mario',
  'The Simpsons',
  'Stranger Things',
  'Indiana Jones',
  'Overwatch',
  'Sonic the Hedgehog',
  'Transformers',
  'Avatar',
  'Wicked',
  'The Lord of the Rings',
  'Spider-Man',
  'Ghostbusters',
  'Back to the Future',
  'Seinfeld',
  'The Office',
  'Friends',
  'Wednesday',
  'Despicable Me',
  'Horizon',
  'Animal Crossing',
  'Fortnite',
];

const UCS_PATTERNS = [
  /ultimate collector/i,
  /\bUCS\b/,
  /Ultimate Collector Series/i,
];

const MODULAR_PATTERNS = [
  /modular build/i,
  /modular house/i,
];

const LEGO_EXCLUSIVE_AVAILABILITY = [
  'LEGO exclusive',
  'LEGO.com exclusive',
  'Exclusive',
];

export interface ClassificationResult {
  total_classified: number;
  is_licensed_count: number;
  is_ucs_count: number;
  is_modular_count: number;
  exclusivity_counts: Record<string, number>;
  overrides_preserved: number;
  duration_ms: number;
}

export class InvestmentClassificationService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Run auto-classification on all sets.
   * Respects classification_override JSONB column.
   */
  async classifyAll(): Promise<ClassificationResult> {
    const startTime = Date.now();
    let totalClassified = 0;
    let isLicensedCount = 0;
    let isUcsCount = 0;
    let isModularCount = 0;
    let overridesPreserved = 0;
    const exclusivityCounts: Record<string, number> = {
      standard: 0,
      lego_exclusive: 0,
      retailer_exclusive: 0,
      event_exclusive: 0,
    };

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: sets, error } = await this.supabase
        .from('brickset_sets')
        .select('id, set_number, set_name, theme, subtheme, availability, classification_override')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[Classification] Error fetching sets:', error.message);
        break;
      }

      if (!sets || sets.length === 0) {
        hasMore = false;
        break;
      }

      const updates: { id: string; is_licensed: boolean; is_ucs: boolean; is_modular: boolean; exclusivity_tier: string }[] = [];

      for (const set of sets) {
        const override = set.classification_override as Record<string, unknown> | null;

        // Auto-detect values
        const autoLicensed = this.detectLicensed(set.theme, set.subtheme);
        const autoUcs = this.detectUcs(set.subtheme, set.set_name);
        const autoModular = this.detectModular(set.theme, set.subtheme, set.set_name);
        const autoExclusivity = this.detectExclusivity(set.availability);

        // Apply overrides
        const isLicensed = override?.is_licensed !== undefined ? Boolean(override.is_licensed) : autoLicensed;
        const isUcs = override?.is_ucs !== undefined ? Boolean(override.is_ucs) : autoUcs;
        const isModular = override?.is_modular !== undefined ? Boolean(override.is_modular) : autoModular;
        const exclusivityTier = override?.exclusivity_tier !== undefined
          ? String(override.exclusivity_tier)
          : autoExclusivity;

        if (override && Object.keys(override).length > 0) {
          overridesPreserved++;
        }

        updates.push({
          id: set.id,
          is_licensed: isLicensed,
          is_ucs: isUcs,
          is_modular: isModular,
          exclusivity_tier: exclusivityTier,
        });

        if (isLicensed) isLicensedCount++;
        if (isUcs) isUcsCount++;
        if (isModular) isModularCount++;
        exclusivityCounts[exclusivityTier] = (exclusivityCounts[exclusivityTier] ?? 0) + 1;
      }

      // Batch update in chunks of 500
      for (let i = 0; i < updates.length; i += 500) {
        const chunk = updates.slice(i, i + 500);
        const { error: updateError } = await this.supabase
          .from('brickset_sets')
          .upsert(
            chunk.map((u) => ({
              id: u.id,
              is_licensed: u.is_licensed,
              is_ucs: u.is_ucs,
              is_modular: u.is_modular,
              exclusivity_tier: u.exclusivity_tier,
            })),
            { onConflict: 'id' }
          );

        if (updateError) {
          console.error('[Classification] Update error:', updateError.message);
        } else {
          totalClassified += chunk.length;
        }
      }

      hasMore = sets.length === pageSize;
      page++;
    }

    const duration = Date.now() - startTime;
    console.log(
      `[Classification] Complete: ${totalClassified} sets classified, ${isLicensedCount} licensed, ${isUcsCount} UCS, ${isModularCount} modular in ${duration}ms`
    );

    return {
      total_classified: totalClassified,
      is_licensed_count: isLicensedCount,
      is_ucs_count: isUcsCount,
      is_modular_count: isModularCount,
      exclusivity_counts: exclusivityCounts,
      overrides_preserved: overridesPreserved,
      duration_ms: duration,
    };
  }

  private detectLicensed(theme: string | null, subtheme: string | null): boolean {
    if (!theme) return false;
    return LICENSED_THEMES.some(
      (lt) =>
        theme.toLowerCase() === lt.toLowerCase() ||
        (subtheme && subtheme.toLowerCase() === lt.toLowerCase())
    );
  }

  private detectUcs(subtheme: string | null, setName: string | null): boolean {
    const text = `${subtheme ?? ''} ${setName ?? ''}`;
    return UCS_PATTERNS.some((pattern) => pattern.test(text));
  }

  private detectModular(theme: string | null, subtheme: string | null, setName: string | null): boolean {
    const text = `${theme ?? ''} ${subtheme ?? ''} ${setName ?? ''}`;
    if (MODULAR_PATTERNS.some((pattern) => pattern.test(text))) return true;
    // Creator Expert / Icons modulars
    if ((theme === 'Creator Expert' || theme === 'Icons') && subtheme?.toLowerCase().includes('modular')) {
      return true;
    }
    return false;
  }

  private detectExclusivity(availability: string | null): string {
    if (!availability) return 'standard';
    if (LEGO_EXCLUSIVE_AVAILABILITY.some((a) => availability.toLowerCase().includes(a.toLowerCase()))) {
      return 'lego_exclusive';
    }
    if (availability.toLowerCase().includes('retailer exclusive')) {
      return 'retailer_exclusive';
    }
    if (availability.toLowerCase().includes('event') || availability.toLowerCase().includes('convention')) {
      return 'event_exclusive';
    }
    return 'standard';
  }
}
