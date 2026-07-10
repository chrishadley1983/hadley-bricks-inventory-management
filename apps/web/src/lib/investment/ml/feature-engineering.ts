/**
 * Feature Engineering Pipeline (v2)
 *
 * Transforms brickset_sets + investment_historical data into
 * normalised feature vectors for model training and inference.
 *
 * v2 changes over v1:
 * - Target is a winsorized log price-ratio, not a raw percentage — a handful
 *   of extreme labels can no longer dominate the MSE loss.
 * - Theme is one-hot encoded (top N by training count) plus a leakage-free
 *   target encoding computed on the training fold only (leave-one-out for
 *   training samples).
 * - Missing sales rank gets an explicit indicator + training-median imputation
 *   instead of silently becoming 0 ("best rank on Amazon").
 * - years_on_market (release -> retirement) replaces set_age_years, whose
 *   meaning differed between training and inference.
 * - Feature count is derived from the norm context, not hardcoded.
 * - Only trains on rows labelled by median_window_v2 (junk-filtered,
 *   corroborated labels).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRecords } from '@/lib/supabase/pagination';
import { LABEL_METHOD } from '../historical-appreciation.service';

/** Winsorization bounds for appreciation labels/predictions, in percent. */
export const APPRECIATION_FLOOR_PCT = -95;
export const APPRECIATION_CEIL_PCT = 400;

/** Number of themes that get their own one-hot column. */
export const TOP_THEME_COUNT = 20;

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
  /** Years from release to (actual/expected) retirement, >= 0. */
  years_on_market: number;
  has_amazon_listing: boolean;
  avg_sales_rank: number | null;
  /**
   * Theme appreciation prior in percent. For training samples this must be a
   * leave-one-out value; for inference use the norm context's encoding.
   */
  theme_avg_appreciation: number;
}

/**
 * Training sample with features and per-horizon labels (percent, unwinsorized).
 * A null label means that horizon had no corroborated price window.
 */
export interface TrainingSample {
  features: RawFeatures;
  appreciation_1yr_pct: number | null;
  appreciation_3yr_pct: number | null;
  retired_date: string;
  retired_date_estimated: boolean;
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
 * Everything here is computed from the TRAINING fold only.
 */
export interface FeatureNormContext {
  version: 2;
  numeric_stats: Record<string, NormStats>;
  /** Imputation value for missing sales rank (training median). */
  sales_rank_median: number;
  /** Themes with their own one-hot column, in column order. */
  theme_onehot: string[];
  /** Training-fold mean winsorized appreciation (pct) per theme. */
  theme_target_encoding: Record<string, number>;
  /** Fallback for themes unseen in training. */
  global_mean_appreciation: number;
  exclusivity_encoding: Record<string, number>;
  feature_names: string[];
}

/** Exclusivity tier encoding (ordinal) */
export const EXCLUSIVITY_MAP: Record<string, number> = {
  standard: 0,
  retailer_exclusive: 1,
  lego_exclusive: 2,
  event_exclusive: 3,
};

const NUMERIC_FEATURE_NAMES = [
  'piece_count',
  'minifig_count',
  'rrp_gbp',
  'price_per_piece',
  'years_on_market',
  'avg_sales_rank',
  'theme_avg_appreciation',
];

/** Clamp appreciation (pct) into the winsorization band. */
export function winsorizeAppreciation(pct: number): number {
  return Math.min(Math.max(pct, APPRECIATION_FLOOR_PCT), APPRECIATION_CEIL_PCT);
}

/**
 * Transform appreciation percent into the model target: log price ratio.
 * +100% -> ln(2), 0% -> 0, -50% -> ln(0.5).
 */
export function appreciationToTarget(pct: number): number {
  return Math.log(1 + winsorizeAppreciation(pct) / 100);
}

/** Inverse of appreciationToTarget, clamped to the winsorization band. */
export function targetToAppreciation(y: number): number {
  return winsorizeAppreciation((Math.exp(y) - 1) * 100);
}

/**
 * Fetch training samples from the database: retired sets with v2
 * (junk-filtered, corroborated) historical appreciation labels.
 */
export async function fetchTrainingSamples(supabase: SupabaseClient): Promise<TrainingSample[]> {
  const samples: TrainingSample[] = [];

  const pageSize = 1000;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('investment_historical')
      .select('*')
      .in('data_quality', ['good', 'partial'])
      .eq('label_method' as string, LABEL_METHOD)
      .not('retired_date', 'is', null)
      .or('actual_1yr_appreciation.not.is.null,actual_3yr_appreciation.not.is.null')
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

      const retiredDate = h.retired_date as string;
      const pieceCount = (setData.pieces as number | null) ?? 0;
      const theme = (setData.theme as string | null) ?? 'Unknown';
      const yearFrom = setData.year_from as number | null;
      const retiredYear = parseInt(retiredDate.slice(0, 4), 10);

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
          years_on_market: yearFrom ? Math.max(retiredYear - yearFrom, 0) : 0,
          has_amazon_listing: (setData.has_amazon_listing as boolean | null) ?? false,
          avg_sales_rank: h.avg_sales_rank_post as number | null,
          theme_avg_appreciation: 0, // assigned by the training service (LOO)
        },
        appreciation_1yr_pct: h.actual_1yr_appreciation as number | null,
        appreciation_3yr_pct: h.actual_3yr_appreciation as number | null,
        retired_date: retiredDate,
        retired_date_estimated: (h.retired_date_estimated as boolean | null) ?? true,
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
      .select(
        'set_number, theme, pieces, minifigs, uk_retail_price, year_from, exclusivity_tier, is_licensed, is_ucs, is_modular, has_amazon_listing'
      )
      .in('set_number', chunk);

    if (error) {
      console.error('[FeatureEng] Error fetching set data:', error.message);
      continue;
    }

    for (const row of data ?? []) {
      const r = row as unknown as Record<string, unknown>;
      map.set(r.set_number as string, r);
    }
  }

  return map;
}

/**
 * Fetch average historical appreciation per theme across ALL clean historical
 * data (winsorized). Used as a SCORING blend factor at inference time, where
 * all historical data is legitimately in the past. Do NOT use for training
 * features — the training service builds a leakage-free fold-only encoding.
 */
export async function fetchThemeAverages(supabase: SupabaseClient): Promise<Map<string, number>> {
  const themeAvgs = new Map<string, number>();

  let historicalRows: Record<string, unknown>[] = [];
  try {
    historicalRows = (await fetchAllRecords(supabase, 'investment_historical', {
      select: 'set_num, actual_1yr_appreciation',
      in: { data_quality: ['good', 'partial'] },
      eq: { label_method: LABEL_METHOD },
      isNotNull: ['actual_1yr_appreciation'],
    })) as unknown as Record<string, unknown>[];
  } catch (err) {
    console.error(
      '[FeatureEng] Error fetching historical for theme averages:',
      err instanceof Error ? err.message : err
    );
    historicalRows = [];
  }

  const allHistorical = historicalRows.map((h) => ({
    set_num: h.set_num as string,
    appreciation: winsorizeAppreciation(h.actual_1yr_appreciation as number),
  }));

  if (allHistorical.length === 0) return themeAvgs;

  // Paginate set -> theme mapping
  const pageSize = 1000;
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
 * Build normalisation context from TRAINING-fold samples only.
 * The samples' theme_avg_appreciation fields must already hold their
 * leave-one-out values (set by the training service).
 */
export function buildNormContext(samples: TrainingSample[]): FeatureNormContext {
  // Top-N themes by training-sample count get one-hot columns
  const themeCounts = new Map<string, number>();
  for (const s of samples) {
    themeCounts.set(s.features.theme, (themeCounts.get(s.features.theme) ?? 0) + 1);
  }
  const themeOnehot = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_THEME_COUNT)
    .map(([t]) => t);

  // Theme target encoding: training-fold mean winsorized 1yr appreciation
  const themeSums = new Map<string, { sum: number; n: number }>();
  let globalSum = 0;
  let globalN = 0;
  for (const s of samples) {
    if (s.appreciation_1yr_pct == null) continue;
    const a = winsorizeAppreciation(s.appreciation_1yr_pct);
    const entry = themeSums.get(s.features.theme) ?? { sum: 0, n: 0 };
    entry.sum += a;
    entry.n += 1;
    themeSums.set(s.features.theme, entry);
    globalSum += a;
    globalN += 1;
  }
  const globalMean = globalN > 0 ? globalSum / globalN : 0;
  const themeTargetEncoding: Record<string, number> = {};
  for (const [theme, { sum, n }] of themeSums) {
    themeTargetEncoding[theme] = sum / n;
  }

  // Sales rank imputation median (from samples that have one)
  const ranks = samples
    .map((s) => s.features.avg_sales_rank)
    .filter((r): r is number => r != null && r > 0)
    .sort((a, b) => a - b);
  const salesRankMedian =
    ranks.length === 0
      ? 100000
      : ranks.length % 2 === 0
        ? (ranks[ranks.length / 2 - 1] + ranks[ranks.length / 2]) / 2
        : ranks[Math.floor(ranks.length / 2)];

  // Numeric feature stats (sales rank uses imputed values so stats match usage)
  const numericStats: Record<string, NormStats> = {};
  for (const name of NUMERIC_FEATURE_NAMES) {
    const values = samples.map((s) => {
      if (name === 'avg_sales_rank') {
        return s.features.avg_sales_rank ?? salesRankMedian;
      }
      const v = s.features[name as keyof RawFeatures];
      return typeof v === 'number' ? v : 0;
    });

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance) || 1; // Avoid division by zero

    numericStats[name] = { mean, std };
  }

  const featureNames = [
    ...NUMERIC_FEATURE_NAMES,
    'sales_rank_missing',
    'exclusivity_encoded',
    'is_licensed',
    'is_ucs',
    'is_modular',
    'has_amazon_listing',
    ...themeOnehot.map((t) => `theme_${t}`),
  ];

  return {
    version: 2,
    numeric_stats: numericStats,
    sales_rank_median: salesRankMedian,
    theme_onehot: themeOnehot,
    theme_target_encoding: themeTargetEncoding,
    global_mean_appreciation: globalMean,
    exclusivity_encoding: EXCLUSIVITY_MAP,
    feature_names: featureNames,
  };
}

/**
 * Convert raw features to a normalised numeric vector.
 */
export function featuresToVector(features: RawFeatures, ctx: FeatureNormContext): number[] {
  const normalise = (name: string, value: number): number => {
    const stats = ctx.numeric_stats[name];
    if (!stats) return value;
    return (value - stats.mean) / stats.std;
  };

  const salesRankMissing = features.avg_sales_rank == null || features.avg_sales_rank <= 0;
  const salesRank = salesRankMissing ? ctx.sales_rank_median : features.avg_sales_rank!;

  const vector = [
    normalise('piece_count', features.piece_count),
    normalise('minifig_count', features.minifig_count),
    normalise('rrp_gbp', features.rrp_gbp),
    normalise('price_per_piece', features.price_per_piece),
    normalise('years_on_market', features.years_on_market),
    normalise('avg_sales_rank', salesRank),
    normalise('theme_avg_appreciation', features.theme_avg_appreciation),
    salesRankMissing ? 1 : 0,
    (ctx.exclusivity_encoding[features.exclusivity_tier] ?? 0) / 3,
    features.is_licensed ? 1 : 0,
    features.is_ucs ? 1 : 0,
    features.is_modular ? 1 : 0,
    features.has_amazon_listing ? 1 : 0,
  ];

  // Theme one-hot (unlisted themes are all-zeros)
  for (const theme of ctx.theme_onehot) {
    vector.push(features.theme === theme ? 1 : 0);
  }

  return vector;
}

/**
 * Get the number of features for a given norm context.
 */
export function getFeatureCount(ctx: FeatureNormContext): number {
  return ctx.feature_names.length;
}
