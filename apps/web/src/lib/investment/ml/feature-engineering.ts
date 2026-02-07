/**
 * Feature Engineering Pipeline
 *
 * Transforms brickset_sets + investment_historical data into
 * normalised feature vectors for TensorFlow.js model training and inference.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Raw features extracted from the database before normalisation.
 */
export interface RawFeatures {
  set_num: string;
  theme: string;
  piece_count: number;
  minifig_count: number;
  rrp_gbp: number;
  price_per_piece: number;
  exclusivity_tier: string;
  is_licensed: boolean;
  is_ucs: boolean;
  is_modular: boolean;
  set_age_years: number;
  has_amazon_listing: boolean;
  avg_sales_rank: number | null;
  theme_historical_avg_appreciation: number;
}

/**
 * Training sample with features and labels.
 */
export interface TrainingSample {
  features: RawFeatures;
  labels: {
    actual_1yr_appreciation: number;
    actual_3yr_appreciation: number;
  };
}

/**
 * Normalisation statistics for each numeric feature.
 */
export interface NormStats {
  mean: number;
  std: number;
}

/**
 * Complete normalisation context for reproducible feature transforms.
 */
export interface FeatureNormContext {
  numeric_stats: Record<string, NormStats>;
  theme_encoding: Record<string, number>;
  exclusivity_encoding: Record<string, number>;
  feature_names: string[];
}

/** Exclusivity tier encoding (ordinal) */
const EXCLUSIVITY_MAP: Record<string, number> = {
  standard: 0,
  retailer_exclusive: 1,
  lego_exclusive: 2,
  event_exclusive: 3,
};

/**
 * Fetch training samples from the database: retired sets with historical appreciation.
 */
export async function fetchTrainingSamples(
  supabase: SupabaseClient
): Promise<TrainingSample[]> {
  const samples: TrainingSample[] = [];

  // Fetch theme averages once (outside pagination loop)
  const themeAvgs = await fetchThemeAverages(supabase);

  const pageSize = 1000;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('investment_historical')
      .select('*')
      .in('data_quality', ['good', 'partial'])
      .not('actual_1yr_appreciation', 'is', null)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('[FeatureEng] Error fetching historical:', error.message);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    // For each historical record, fetch the matching brickset_sets data
    const setNums = data.map((d) => (d as Record<string, unknown>).set_num as string);
    const setDataMap = await fetchSetData(supabase, setNums);

    for (const row of data) {
      const h = row as Record<string, unknown>;
      const setNum = h.set_num as string;
      const setData = setDataMap.get(setNum);
      if (!setData) continue;

      const rrp = setData.uk_retail_price as number | null;
      if (!rrp || rrp <= 0) continue;

      const pieceCount = (setData.pieces as number | null) ?? 0;
      const theme = (setData.theme as string | null) ?? 'Unknown';

      samples.push({
        features: {
          set_num: setNum,
          theme,
          piece_count: pieceCount,
          minifig_count: (setData.minifigs as number | null) ?? 0,
          rrp_gbp: rrp,
          price_per_piece: pieceCount > 0 ? rrp / pieceCount : 0,
          exclusivity_tier: (setData.exclusivity_tier as string | null) ?? 'standard',
          is_licensed: (setData.is_licensed as boolean | null) ?? false,
          is_ucs: (setData.is_ucs as boolean | null) ?? false,
          is_modular: (setData.is_modular as boolean | null) ?? false,
          set_age_years: (setData.year_from as number | null)
            ? new Date().getFullYear() - (setData.year_from as number)
            : 0,
          has_amazon_listing: (setData.has_amazon_listing as boolean | null) ?? false,
          avg_sales_rank: h.avg_sales_rank_post as number | null,
          theme_historical_avg_appreciation: themeAvgs.get(theme) ?? 0,
        },
        labels: {
          actual_1yr_appreciation: h.actual_1yr_appreciation as number,
          actual_3yr_appreciation: (h.actual_3yr_appreciation as number | null) ?? (h.actual_1yr_appreciation as number),
        },
      });
    }

    hasMore = data.length === pageSize;
    page++;
  }

  return samples;
}

/**
 * Fetch set data from brickset_sets for a list of set numbers.
 */
async function fetchSetData(
  supabase: SupabaseClient,
  setNums: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < setNums.length; i += 100) {
    const chunk = setNums.slice(i, i + 100);
    const { data, error } = await supabase
      .from('brickset_sets')
      .select('set_number, theme, pieces, minifigs, uk_retail_price, year_from, exclusivity_tier, is_licensed, is_ucs, is_modular, has_amazon_listing')
      .in('set_number', chunk);

    if (error) {
      console.error('[FeatureEng] Error fetching set data:', error.message);
      continue;
    }

    for (const row of (data ?? [])) {
      const r = row as unknown as Record<string, unknown>;
      map.set(r.set_number as string, r);
    }
  }

  return map;
}

/**
 * Fetch average historical appreciation per theme.
 * Exported for reuse by scoring.service.ts.
 * Paginates both historical and set data to avoid the 1000-row limit.
 */
export async function fetchThemeAverages(
  supabase: SupabaseClient
): Promise<Map<string, number>> {
  const themeAvgs = new Map<string, number>();

  // Paginate investment_historical to get all appreciation data
  const allHistorical: { set_num: string; appreciation: number }[] = [];
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('investment_historical')
      .select('set_num, actual_1yr_appreciation')
      .in('data_quality', ['good', 'partial'])
      .not('actual_1yr_appreciation', 'is', null)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error || !data || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of data) {
      const h = row as Record<string, unknown>;
      allHistorical.push({
        set_num: h.set_num as string,
        appreciation: h.actual_1yr_appreciation as number,
      });
    }

    hasMore = data.length === pageSize;
    page++;
  }

  if (allHistorical.length === 0) return themeAvgs;

  // Paginate set -> theme mapping
  const allSetNums = allHistorical.map((h) => h.set_num);
  const setThemeMap = new Map<string, string>();

  for (let i = 0; i < allSetNums.length; i += pageSize) {
    const chunk = allSetNums.slice(i, i + pageSize);
    const { data: sets } = await supabase
      .from('brickset_sets')
      .select('set_number, theme')
      .in('set_number', chunk);

    if (!sets) continue;

    for (const s of sets) {
      const r = s as unknown as Record<string, unknown>;
      setThemeMap.set(r.set_number as string, (r.theme as string) ?? 'Unknown');
    }
  }

  // Group appreciations by theme
  const themeApps = new Map<string, number[]>();
  for (const h of allHistorical) {
    const theme = setThemeMap.get(h.set_num);
    if (!theme) continue;
    const apps = themeApps.get(theme) ?? [];
    apps.push(h.appreciation);
    themeApps.set(theme, apps);
  }

  // Calculate averages
  for (const [theme, apps] of themeApps) {
    themeAvgs.set(theme, apps.reduce((sum, a) => sum + a, 0) / apps.length);
  }

  return themeAvgs;
}

/**
 * Build normalisation context from training samples.
 */
export function buildNormContext(samples: TrainingSample[]): FeatureNormContext {
  // Build theme encoding from all unique themes
  const themes = [...new Set(samples.map((s) => s.features.theme))].sort();
  const themeEncoding: Record<string, number> = {};
  themes.forEach((t, i) => { themeEncoding[t] = i; });

  // Numeric features to normalise
  const numericFeatureNames = [
    'piece_count', 'minifig_count', 'rrp_gbp', 'price_per_piece',
    'set_age_years', 'avg_sales_rank', 'theme_historical_avg_appreciation',
  ];

  const numericStats: Record<string, NormStats> = {};

  for (const name of numericFeatureNames) {
    const values = samples.map((s) => {
      const v = s.features[name as keyof RawFeatures];
      return typeof v === 'number' ? v : (v === null ? 0 : 0);
    });

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance) || 1; // Avoid division by zero

    numericStats[name] = { mean, std };
  }

  const featureNames = [
    ...numericFeatureNames,
    'theme_encoded',
    'exclusivity_encoded',
    'is_licensed', 'is_ucs', 'is_modular', 'has_amazon_listing',
  ];

  return {
    numeric_stats: numericStats,
    theme_encoding: themeEncoding,
    exclusivity_encoding: EXCLUSIVITY_MAP,
    feature_names: featureNames,
  };
}

/**
 * Convert raw features to a normalised numeric vector.
 */
export function featuresToVector(
  features: RawFeatures,
  ctx: FeatureNormContext
): number[] {
  const normalise = (name: string, value: number): number => {
    const stats = ctx.numeric_stats[name];
    if (!stats) return value;
    return (value - stats.mean) / stats.std;
  };

  return [
    normalise('piece_count', features.piece_count),
    normalise('minifig_count', features.minifig_count),
    normalise('rrp_gbp', features.rrp_gbp),
    normalise('price_per_piece', features.price_per_piece),
    normalise('set_age_years', features.set_age_years),
    normalise('avg_sales_rank', features.avg_sales_rank ?? 0),
    normalise('theme_historical_avg_appreciation', features.theme_historical_avg_appreciation),
    // Theme encoding (normalised to 0-1 range)
    (ctx.theme_encoding[features.theme] ?? 0) / Math.max(Object.keys(ctx.theme_encoding).length - 1, 1),
    // Exclusivity encoding (normalised to 0-1)
    (ctx.exclusivity_encoding[features.exclusivity_tier] ?? 0) / 3,
    // Boolean features (0 or 1)
    features.is_licensed ? 1 : 0,
    features.is_ucs ? 1 : 0,
    features.is_modular ? 1 : 0,
    features.has_amazon_listing ? 1 : 0,
  ];
}

/**
 * Get the number of features in the vector.
 */
export function getFeatureCount(): number {
  return 13; // Must match featuresToVector output length
}
