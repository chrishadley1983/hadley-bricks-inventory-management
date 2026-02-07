/**
 * Investment Scoring Service
 *
 * Computes a composite investment score (1-10) per set by combining:
 * - ML predicted appreciation (40% weight)
 * - Theme historical performance (20%)
 * - Exclusivity tier bonus (15%)
 * - Demand indicators from sales_rank/offer_count (15%)
 * - Retirement timing proximity (10%)
 *
 * Falls back to rule-based scoring when no ML model is available.
 */

import * as tf from '@tensorflow/tfjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ModelTrainingService } from './ml/model-training.service';
import {
  featuresToVector,
  fetchThemeAverages,
  type RawFeatures,
  type FeatureNormContext,
} from './ml/feature-engineering';

export interface ScoringResult {
  sets_scored: number;
  errors: number;
  model_version: string | null;
  used_fallback: boolean;
  duration_ms: number;
}

interface SetForScoring {
  set_number: string;
  theme: string;
  pieces: number;
  minifigs: number;
  uk_retail_price: number;
  year_from: number;
  exclusivity_tier: string;
  is_licensed: boolean;
  is_ucs: boolean;
  is_modular: boolean;
  has_amazon_listing: boolean;
  retirement_status: string;
  expected_retirement_date: string | null;
  amazon_asin: string | null;
}

interface PredictionRow {
  set_num: string;
  investment_score: number;
  predicted_1yr_appreciation: number | null;
  predicted_3yr_appreciation: number | null;
  predicted_1yr_price_gbp: number | null;
  predicted_3yr_price_gbp: number | null;
  confidence: number;
  risk_factors: string[];
  amazon_viable: boolean;
  model_version: string | null;
}

export class InvestmentScoringService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Score all eligible sets (available or retiring_soon).
   */
  async scoreAll(): Promise<ScoringResult> {
    const startTime = Date.now();
    let setsScored = 0;
    let errors = 0;

    // Try to load ML model
    const modelData = await ModelTrainingService.loadModel(this.supabase);
    const useFallback = !modelData;
    const modelVersion = modelData?.modelVersion ?? null;

    // Fetch theme averages for scoring (shared with feature-engineering)
    const themeAvgs = await fetchThemeAverages(this.supabase);

    // Fetch demand data (latest sales ranks)
    const demandData = await this.fetchDemandData();

    // Fetch eligible sets in pages
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('brickset_sets')
        .select('set_number, theme, pieces, minifigs, uk_retail_price, year_from, exclusivity_tier, is_licensed, is_ucs, is_modular, has_amazon_listing, retirement_status, expected_retirement_date, amazon_asin')
        .in('retirement_status' as string, ['available', 'retiring_soon'])
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[Scoring] Error fetching sets:', error.message);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      const predictions: PredictionRow[] = [];

      for (const row of data) {
        try {
          const set = this.parseSetRow(row);
          if (!set.uk_retail_price || set.uk_retail_price <= 0) continue;

          const prediction = useFallback
            ? this.scoreFallback(set, themeAvgs, demandData)
            : this.scoreWithModel(set, modelData!.model, modelData!.normContext, modelData!.modelVersion, themeAvgs, demandData);

          predictions.push(prediction);
        } catch (err) {
          console.error(`[Scoring] Error scoring ${(row as Record<string, unknown>).set_number}:`, err);
          errors++;
        }
      }

      // Batch upsert predictions
      if (predictions.length > 0) {
        for (let i = 0; i < predictions.length; i += 500) {
          const chunk = predictions.slice(i, i + 500);
          const { error: upsertError } = await this.supabase
            .from('investment_predictions')
            .upsert(
              chunk.map((p) => ({
                set_num: p.set_num,
                investment_score: p.investment_score,
                predicted_1yr_appreciation: p.predicted_1yr_appreciation,
                predicted_3yr_appreciation: p.predicted_3yr_appreciation,
                predicted_1yr_price_gbp: p.predicted_1yr_price_gbp,
                predicted_3yr_price_gbp: p.predicted_3yr_price_gbp,
                confidence: p.confidence,
                risk_factors: p.risk_factors,
                amazon_viable: p.amazon_viable,
                model_version: p.model_version,
                scored_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })) as unknown as Record<string, unknown>[],
              { onConflict: 'set_num' }
            );

          if (upsertError) {
            console.error('[Scoring] Upsert error:', upsertError.message);
            errors += chunk.length;
          } else {
            setsScored += chunk.length;
          }
        }
      }

      hasMore = data.length === pageSize;
      page++;
    }

    // Clean up model if loaded
    if (modelData) {
      modelData.model.dispose();
    }

    console.log(`[Scoring] Complete: ${setsScored} scored, ${errors} errors, fallback=${useFallback}`);

    return {
      sets_scored: setsScored,
      errors,
      model_version: modelVersion,
      used_fallback: useFallback,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Score a set using the ML model + composite factors.
   */
  private scoreWithModel(
    set: SetForScoring,
    model: tf.Sequential,
    normContext: FeatureNormContext,
    modelVersion: string,
    themeAvgs: Map<string, number>,
    demandData: Map<string, { salesRank: number; offerCount: number }>
  ): PredictionRow {
    const features = this.buildFeatures(set, themeAvgs, demandData);
    const vector = featuresToVector(features, normContext);

    // Run inference
    const inputTensor = tf.tensor2d([vector]);
    const prediction = model.predict(inputTensor) as tf.Tensor2D;
    const [pred1yr, pred3yr] = prediction.dataSync();
    inputTensor.dispose();
    prediction.dispose();

    // Normalise ML appreciation to 0-1 (assume typical range -50% to +200%)
    const mlFactor = Math.min(Math.max((pred1yr + 50) / 250, 0), 1);

    // Theme factor
    const themeAvg = themeAvgs.get(set.theme) ?? 0;
    const themeFactor = Math.min(Math.max((themeAvg + 50) / 250, 0), 1);

    // Exclusivity factor
    const exclusivityFactor = this.getExclusivityFactor(set.exclusivity_tier);

    // Demand factor
    const demand = demandData.get(set.set_number);
    const demandFactor = this.getDemandFactor(demand);

    // Retirement timing factor
    const timingFactor = this.getRetirementTimingFactor(set);

    // Composite score: weighted average * 9 + 1 (to get 1-10 range)
    const composite =
      mlFactor * 0.40 +
      themeFactor * 0.20 +
      exclusivityFactor * 0.15 +
      demandFactor * 0.15 +
      timingFactor * 0.10;

    const score = Math.round((composite * 9 + 1) * 10) / 10; // 1 decimal place
    const clampedScore = Math.min(Math.max(score, 1.0), 10.0);

    // Risk factors
    const riskFactors = this.assessRiskFactors(set, pred1yr, demand);

    return {
      set_num: set.set_number,
      investment_score: clampedScore,
      predicted_1yr_appreciation: Math.round(pred1yr * 100) / 100,
      predicted_3yr_appreciation: Math.round(pred3yr * 100) / 100,
      predicted_1yr_price_gbp: Math.round(set.uk_retail_price * (1 + pred1yr / 100) * 100) / 100,
      predicted_3yr_price_gbp: Math.round(set.uk_retail_price * (1 + pred3yr / 100) * 100) / 100,
      confidence: 0.7, // Model-based prediction
      risk_factors: riskFactors,
      amazon_viable: set.has_amazon_listing,
      model_version: modelVersion,
    };
  }

  /**
   * Score a set using rule-based fallback (no ML model).
   */
  private scoreFallback(
    set: SetForScoring,
    themeAvgs: Map<string, number>,
    demandData: Map<string, { salesRank: number; offerCount: number }>
  ): PredictionRow {
    // Theme factor
    const themeAvg = themeAvgs.get(set.theme) ?? 0;
    const themeFactor = Math.min(Math.max((themeAvg + 50) / 250, 0), 1);

    // Exclusivity factor
    const exclusivityFactor = this.getExclusivityFactor(set.exclusivity_tier);

    // Demand factor
    const demand = demandData.get(set.set_number);
    const demandFactor = this.getDemandFactor(demand);

    // Retirement timing factor
    const timingFactor = this.getRetirementTimingFactor(set);

    // Without ML, redistribute ML weight (40%) to other factors
    const composite =
      themeFactor * 0.35 +
      exclusivityFactor * 0.25 +
      demandFactor * 0.25 +
      timingFactor * 0.15;

    const score = Math.round((composite * 9 + 1) * 10) / 10;
    const clampedScore = Math.min(Math.max(score, 1.0), 10.0);

    const riskFactors = this.assessRiskFactors(set, null, demand);
    riskFactors.push('no_ml_model_available');

    return {
      set_num: set.set_number,
      investment_score: clampedScore,
      predicted_1yr_appreciation: null,
      predicted_3yr_appreciation: null,
      predicted_1yr_price_gbp: null,
      predicted_3yr_price_gbp: null,
      confidence: 0,
      risk_factors: riskFactors,
      amazon_viable: set.has_amazon_listing,
      model_version: null,
    };
  }

  /**
   * Get normalised exclusivity factor (0-1).
   */
  private getExclusivityFactor(tier: string): number {
    const map: Record<string, number> = {
      standard: 0.2,
      retailer_exclusive: 0.5,
      lego_exclusive: 0.8,
      event_exclusive: 1.0,
    };
    return map[tier] ?? 0.2;
  }

  /**
   * Get normalised demand factor from sales rank and offer count.
   */
  private getDemandFactor(
    demand: { salesRank: number; offerCount: number } | undefined
  ): number {
    if (!demand) return 0.5; // Neutral if no data

    // Lower sales rank = higher demand (log scale)
    // Typical LEGO ranks: 1000-500000
    const rankFactor = demand.salesRank > 0
      ? 1 - Math.min(Math.log10(demand.salesRank) / 6, 1)
      : 0.5;

    // Fewer offers = less competition = slightly better
    const offerFactor = demand.offerCount > 0
      ? Math.max(1 - demand.offerCount / 50, 0)
      : 0.5;

    return rankFactor * 0.7 + offerFactor * 0.3;
  }

  /**
   * Get retirement timing factor.
   * Sets closer to retirement score higher.
   */
  private getRetirementTimingFactor(set: SetForScoring): number {
    if (set.retirement_status === 'retiring_soon') return 1.0;
    if (set.retirement_status !== 'available') return 0.3;

    if (!set.expected_retirement_date) return 0.3;

    const now = new Date();
    const retireDate = new Date(set.expected_retirement_date);
    const monthsUntil = (retireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);

    if (monthsUntil <= 3) return 0.9;
    if (monthsUntil <= 6) return 0.7;
    if (monthsUntil <= 12) return 0.5;
    return 0.3;
  }

  /**
   * Assess risk factors for a set.
   */
  private assessRiskFactors(
    set: SetForScoring,
    prediction: number | null,
    demand: { salesRank: number; offerCount: number } | undefined
  ): string[] {
    const risks: string[] = [];

    if (!set.has_amazon_listing) risks.push('no_amazon_listing');
    if (!set.expected_retirement_date) risks.push('unknown_retirement_date');
    if (set.exclusivity_tier === 'standard') risks.push('standard_retail_availability');
    if (demand && demand.salesRank > 100000) risks.push('low_demand_high_sales_rank');
    if (demand && demand.offerCount > 30) risks.push('high_competition_many_sellers');
    if (prediction !== null && prediction < 0) risks.push('predicted_depreciation');
    if (set.uk_retail_price > 300) risks.push('high_rrp_capital_required');

    return risks;
  }

  /**
   * Build raw features for a set (for ML inference).
   */
  private buildFeatures(
    set: SetForScoring,
    themeAvgs: Map<string, number>,
    demandData: Map<string, { salesRank: number; offerCount: number }>
  ): RawFeatures {
    const demand = demandData.get(set.set_number);
    return {
      set_num: set.set_number,
      theme: set.theme,
      piece_count: set.pieces,
      minifig_count: set.minifigs,
      rrp_gbp: set.uk_retail_price,
      price_per_piece: set.pieces > 0 ? set.uk_retail_price / set.pieces : 0,
      exclusivity_tier: set.exclusivity_tier,
      is_licensed: set.is_licensed,
      is_ucs: set.is_ucs,
      is_modular: set.is_modular,
      set_age_years: set.year_from ? new Date().getFullYear() - set.year_from : 0,
      has_amazon_listing: set.has_amazon_listing,
      avg_sales_rank: demand?.salesRank ?? null,
      theme_historical_avg_appreciation: themeAvgs.get(set.theme) ?? 0,
    };
  }

  /**
   * Parse a Supabase row into a typed SetForScoring.
   */
  private parseSetRow(row: unknown): SetForScoring {
    const r = row as Record<string, unknown>;
    return {
      set_number: r.set_number as string,
      theme: (r.theme as string | null) ?? 'Unknown',
      pieces: (r.pieces as number | null) ?? 0,
      minifigs: (r.minifigs as number | null) ?? 0,
      uk_retail_price: (r.uk_retail_price as number | null) ?? 0,
      year_from: (r.year_from as number | null) ?? 2020,
      exclusivity_tier: (r.exclusivity_tier as string | null) ?? 'standard',
      is_licensed: (r.is_licensed as boolean | null) ?? false,
      is_ucs: (r.is_ucs as boolean | null) ?? false,
      is_modular: (r.is_modular as boolean | null) ?? false,
      has_amazon_listing: (r.has_amazon_listing as boolean | null) ?? false,
      retirement_status: (r.retirement_status as string | null) ?? 'available',
      expected_retirement_date: r.expected_retirement_date as string | null,
      amazon_asin: r.amazon_asin as string | null,
    };
  }

  /**
   * Fetch latest demand data (sales rank, offer count) per set.
   */
  private async fetchDemandData(): Promise<Map<string, { salesRank: number; offerCount: number }>> {
    const demandMap = new Map<string, { salesRank: number; offerCount: number }>();

    // Paginate price snapshots ordered by date desc, keeping most recent per set
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data } = await this.supabase
        .from('price_snapshots')
        .select('set_num, sales_rank, seller_count, date')
        .in('source', ['keepa_amazon_buybox', 'amazon_buybox'])
        .not('sales_rank', 'is', null)
        .order('date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      // Keep most recent entry per set (data is ordered by date desc)
      for (const row of data) {
        const r = row as Record<string, unknown>;
        const setNum = r.set_num as string;
        if (!demandMap.has(setNum)) {
          demandMap.set(setNum, {
            salesRank: (r.sales_rank as number) ?? 0,
            offerCount: (r.seller_count as number) ?? 0,
          });
        }
      }

      hasMore = data.length === pageSize;
      page++;
    }

    return demandMap;
  }
}
