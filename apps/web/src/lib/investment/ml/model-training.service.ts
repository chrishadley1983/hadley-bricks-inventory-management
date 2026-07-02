/**
 * Investment Model Training Service (v2)
 *
 * Trains per-horizon models (1yr and 3yr post-retirement appreciation) on a
 * winsorized log price-ratio target, and keeps whichever of a closed-form
 * ridge regression or a small TensorFlow.js network wins on the holdout.
 *
 * Evaluation honesty rules:
 * - TEMPORAL split: train on the oldest 80% of retirements, hold out the
 *   newest 20% — no peeking at the future.
 * - Theme priors are computed from the training fold only, leave-one-out for
 *   training samples, so a sample's own label never leaks into its features.
 * - The 3yr model trains only on real 3yr labels (v1 silently substituted the
 *   1yr label).
 * - Every horizon is benchmarked against a theme-average baseline; metrics
 *   record whether the model actually beats it.
 */

import * as tf from '@tensorflow/tfjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchTrainingSamples,
  buildNormContext,
  featuresToVector,
  appreciationToTarget,
  targetToAppreciation,
  winsorizeAppreciation,
  type TrainingSample,
  type FeatureNormContext,
} from './feature-engineering';
import { fitRidge, predictRidge, type RidgeModel } from './ridge';
import { meanAbsoluteError, rSquared, spearman } from './metrics';

export type Horizon = '1yr' | '3yr';

export interface HorizonMetrics {
  model_type: 'ridge' | 'nn';
  /** MAE in appreciation percentage points, on winsorized holdout labels. */
  mae_pct: number;
  r_squared: number;
  /** Spearman rank correlation — the number that matters for ranking buys. */
  spearman: number;
  /** Theme-average baseline MAE on the same holdout. */
  baseline_mae_pct: number;
  beats_baseline: boolean;
  n_train: number;
  n_holdout: number;
}

export interface TrainingMetrics {
  horizon_1yr: HorizonMetrics | null;
  horizon_3yr: HorizonMetrics | null;
  /** Oldest holdout retirement date — everything before this was trainable. */
  temporal_cutoff_date: string;
}

export interface TrainingResult {
  status: 'success' | 'insufficient_data';
  available_samples?: number;
  minimum_required?: number;
  metrics?: TrainingMetrics;
  training_samples?: number;
  holdout_samples?: number;
  model_version?: string;
  duration_ms: number;
}

/** Serialized per-horizon model inside the artifact. */
type SerializedHorizonModel =
  | { type: 'ridge'; weights: number[]; lambda: number }
  | {
      type: 'nn';
      model_topology: unknown;
      weight_specs: tf.io.WeightsManifestEntry[];
      weight_data_base64: string | null;
    }
  | null;

/** Loaded per-horizon model ready for inference. */
export type LoadedHorizonModel =
  | { type: 'ridge'; ridge: RidgeModel }
  | { type: 'nn'; nn: tf.LayersModel };

export interface LoadedArtifact {
  modelVersion: string;
  normContext: FeatureNormContext;
  metrics: TrainingMetrics;
  models: Record<Horizon, LoadedHorizonModel | null>;
}

export const ARTIFACT_VERSION = 2;

const MINIMUM_TRAINING_SAMPLES = 50;
const MINIMUM_HORIZON_SAMPLES = 30;
const HOLDOUT_RATIO = 0.2;
const EPOCHS = 120;
const BATCH_SIZE = 32;
const LEARNING_RATE = 0.002;
const RIDGE_LAMBDA = 1.0;

interface HorizonTrainingOutcome {
  serialized: SerializedHorizonModel;
  metrics: HorizonMetrics | null;
}

export class ModelTrainingService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Train the investment prediction models.
   * Returns insufficient_data status if < 50 usable 1yr samples exist.
   */
  async train(): Promise<TrainingResult> {
    const startTime = Date.now();

    const samples = await fetchTrainingSamples(this.supabase);
    const usable = samples.filter(
      (s) => s.appreciation_1yr_pct != null || s.appreciation_3yr_pct != null
    );
    const with1yr = usable.filter((s) => s.appreciation_1yr_pct != null);

    if (with1yr.length < MINIMUM_TRAINING_SAMPLES) {
      return {
        status: 'insufficient_data',
        available_samples: with1yr.length,
        minimum_required: MINIMUM_TRAINING_SAMPLES,
        duration_ms: Date.now() - startTime,
      };
    }

    // TEMPORAL split: oldest retirements train, newest hold out.
    const ordered = [...usable].sort((a, b) => a.retired_date.localeCompare(b.retired_date));
    const holdoutSize = Math.max(Math.floor(ordered.length * HOLDOUT_RATIO), 1);
    const trainFold = ordered.slice(0, ordered.length - holdoutSize);
    const holdoutFold = ordered.slice(ordered.length - holdoutSize);
    const temporalCutoff = holdoutFold[0].retired_date;

    // Leakage-free theme priors: fold stats + leave-one-out for training rows.
    this.assignThemePriors(trainFold, holdoutFold);

    const normContext = buildNormContext(trainFold);

    const outcome1yr = await this.trainHorizon('1yr', trainFold, holdoutFold, normContext);
    const outcome3yr = await this.trainHorizon('3yr', trainFold, holdoutFold, normContext);

    const metrics: TrainingMetrics = {
      horizon_1yr: outcome1yr.metrics,
      horizon_3yr: outcome3yr.metrics,
      temporal_cutoff_date: temporalCutoff,
    };

    const modelVersion = `v2-${Date.now()}`;

    await this.saveArtifact(normContext, modelVersion, metrics, {
      '1yr': outcome1yr.serialized,
      '3yr': outcome3yr.serialized,
    });

    return {
      status: 'success',
      metrics,
      training_samples: trainFold.length,
      holdout_samples: holdoutFold.length,
      model_version: modelVersion,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Assign theme_avg_appreciation priors in place.
   * Training rows get leave-one-out fold means; holdout rows get plain fold means.
   */
  private assignThemePriors(trainFold: TrainingSample[], holdoutFold: TrainingSample[]): void {
    const themeSums = new Map<string, { sum: number; n: number }>();
    let globalSum = 0;
    let globalN = 0;

    for (const s of trainFold) {
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

    const foldMean = (theme: string): number => {
      const entry = themeSums.get(theme);
      return entry && entry.n > 0 ? entry.sum / entry.n : globalMean;
    };

    for (const s of trainFold) {
      const entry = themeSums.get(s.features.theme);
      if (entry && s.appreciation_1yr_pct != null && entry.n > 1) {
        const own = winsorizeAppreciation(s.appreciation_1yr_pct);
        s.features.theme_avg_appreciation = (entry.sum - own) / (entry.n - 1);
      } else if (entry && s.appreciation_1yr_pct != null && entry.n === 1) {
        // Only sample of its theme — its own label IS the theme mean; use global.
        s.features.theme_avg_appreciation = globalMean;
      } else {
        s.features.theme_avg_appreciation = foldMean(s.features.theme);
      }
    }

    for (const s of holdoutFold) {
      s.features.theme_avg_appreciation = foldMean(s.features.theme);
    }
  }

  /**
   * Train ridge + NN for one horizon, evaluate both on the temporal holdout,
   * and keep the winner (by MAE in percentage points).
   */
  private async trainHorizon(
    horizon: Horizon,
    trainFold: TrainingSample[],
    holdoutFold: TrainingSample[],
    ctx: FeatureNormContext
  ): Promise<HorizonTrainingOutcome> {
    const labelOf = (s: TrainingSample) =>
      horizon === '1yr' ? s.appreciation_1yr_pct : s.appreciation_3yr_pct;

    const train = trainFold.filter((s) => labelOf(s) != null);
    const holdout = holdoutFold.filter((s) => labelOf(s) != null);

    if (train.length < MINIMUM_HORIZON_SAMPLES) {
      console.log(
        `[ModelTraining] Skipping ${horizon}: only ${train.length} labelled training samples`
      );
      return { serialized: null, metrics: null };
    }

    const trainX = train.map((s) => featuresToVector(s.features, ctx));
    const trainY = train.map((s) => appreciationToTarget(labelOf(s)!));
    const holdX = holdout.map((s) => featuresToVector(s.features, ctx));
    const actualPct = holdout.map((s) => winsorizeAppreciation(labelOf(s)!));

    // Ridge (closed-form)
    const ridge = fitRidge(trainX, trainY, RIDGE_LAMBDA);
    const ridgePreds = holdX.map((x) => targetToAppreciation(predictRidge(ridge, x)));

    // Small NN
    const nn = this.buildModel(trainX[0].length);
    const xT = tf.tensor2d(trainX);
    const yT = tf.tensor2d(trainY.map((y) => [y]));
    let nnPreds: number[] = [];
    try {
      await nn.fit(xT, yT, {
        epochs: EPOCHS,
        batchSize: BATCH_SIZE,
        validationSplit: 0.1,
        verbose: 0,
      });
      if (holdX.length > 0) {
        const hT = tf.tensor2d(holdX);
        const pT = nn.predict(hT) as tf.Tensor2D;
        nnPreds = (pT.arraySync() as number[][]).map((p) => targetToAppreciation(p[0]));
        hT.dispose();
        pT.dispose();
      }
    } finally {
      xT.dispose();
      yT.dispose();
    }

    // Theme-average baseline: the holdout features already carry the
    // training-fold theme prior — that IS the baseline prediction.
    const baselinePreds = holdout.map((s) =>
      winsorizeAppreciation(s.features.theme_avg_appreciation)
    );

    let metrics: HorizonMetrics | null = null;
    let winner: 'ridge' | 'nn' = 'ridge';

    if (holdout.length > 0) {
      const ridgeMae = meanAbsoluteError(actualPct, ridgePreds);
      const nnMae = meanAbsoluteError(actualPct, nnPreds);
      winner = nnMae < ridgeMae ? 'nn' : 'ridge';
      const winnerPreds = winner === 'nn' ? nnPreds : ridgePreds;
      const baselineMae = meanAbsoluteError(actualPct, baselinePreds);

      metrics = {
        model_type: winner,
        mae_pct: winner === 'nn' ? nnMae : ridgeMae,
        r_squared: rSquared(actualPct, winnerPreds),
        spearman: spearman(actualPct, winnerPreds),
        baseline_mae_pct: baselineMae,
        beats_baseline: (winner === 'nn' ? nnMae : ridgeMae) < baselineMae,
        n_train: train.length,
        n_holdout: holdout.length,
      };
      console.log(
        `[ModelTraining] ${horizon}: ${winner} wins — MAE ${metrics.mae_pct}pp vs baseline ${baselineMae}pp, spearman ${metrics.spearman}`
      );
    } else {
      console.warn(`[ModelTraining] ${horizon}: no holdout samples — defaulting to ridge`);
    }

    let serialized: SerializedHorizonModel;
    if (winner === 'nn') {
      serialized = await this.serializeNN(nn);
    } else {
      serialized = { type: 'ridge', weights: ridge.weights, lambda: ridge.lambda };
    }
    nn.dispose();

    return { serialized, metrics };
  }

  /**
   * Build the per-horizon neural network (single output on the log target).
   */
  private buildModel(featureCount: number): tf.Sequential {
    const model = tf.sequential();

    model.add(
      tf.layers.dense({
        inputShape: [featureCount],
        units: 32,
        activation: 'relu',
        kernelInitializer: 'heNormal',
      })
    );
    model.add(tf.layers.dropout({ rate: 0.15 }));
    model.add(tf.layers.dense({ units: 16, activation: 'relu', kernelInitializer: 'heNormal' }));
    model.add(tf.layers.dense({ units: 1, activation: 'linear' }));

    model.compile({
      optimizer: tf.train.adam(LEARNING_RATE),
      loss: 'meanSquaredError',
      metrics: ['mae'],
    });

    return model;
  }

  /**
   * Serialize a TF.js model to a JSON-safe structure.
   */
  private async serializeNN(model: tf.Sequential): Promise<SerializedHorizonModel> {
    let serialized: SerializedHorizonModel = null;
    await model.save(
      tf.io.withSaveHandler(async (artifacts) => {
        serialized = {
          type: 'nn',
          model_topology: artifacts.modelTopology,
          weight_specs: artifacts.weightSpecs ?? [],
          weight_data_base64: artifacts.weightData
            ? Buffer.from(new Uint8Array(artifacts.weightData as ArrayBuffer)).toString('base64')
            : null,
        };
        return {
          modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' as const },
        };
      })
    );
    return serialized;
  }

  /**
   * Save the trained models and normalisation context to the database.
   */
  private async saveArtifact(
    normContext: FeatureNormContext,
    modelVersion: string,
    metrics: TrainingMetrics,
    models: Record<Horizon, SerializedHorizonModel>
  ): Promise<void> {
    const artifact = {
      artifact_version: ARTIFACT_VERSION,
      model_version: modelVersion,
      trained_at: new Date().toISOString(),
      metrics,
      norm_context: normContext,
      models,
    };

    // Store as a sentinel row with data_quality='model_artifact'
    // so it's excluded from training queries that filter in('data_quality', ['good', 'partial'])
    const { error } = await this.supabase.from('investment_historical').upsert(
      {
        set_num: '__model_artifact__',
        data_quality: 'model_artifact',
        rrp_gbp: 0,
        raw_data: artifact,
        updated_at: new Date().toISOString(),
      } as unknown as Record<string, unknown>,
      { onConflict: 'set_num' }
    );

    if (error) {
      console.error('[ModelTraining] Error saving model artifact:', error.message);
      throw error;
    }

    console.log(`[ModelTraining] Artifact ${modelVersion} saved to database`);
  }

  /**
   * Load the trained artifact from the database.
   * Returns null if no artifact exists or it predates artifact v2.
   * Call disposeArtifact() when done to free any NN tensors.
   */
  static async loadModel(supabase: SupabaseClient): Promise<LoadedArtifact | null> {
    const { data, error } = await supabase
      .from('investment_historical')
      .select('*')
      .eq('set_num', '__model_artifact__')
      .single();

    if (error || !data) {
      console.log('[ModelTraining] No model artifact found');
      return null;
    }

    const row = data as Record<string, unknown>;
    const rawData = row.raw_data as Record<string, unknown> | null;
    if (!rawData) return null;

    if ((rawData.artifact_version as number | undefined) !== ARTIFACT_VERSION) {
      console.log('[ModelTraining] Artifact predates v2 — ignoring (retrain required)');
      return null;
    }

    try {
      const artifact = rawData as unknown as {
        model_version: string;
        norm_context: FeatureNormContext;
        metrics: TrainingMetrics;
        models: Record<Horizon, SerializedHorizonModel>;
      };

      const models: Record<Horizon, LoadedHorizonModel | null> = { '1yr': null, '3yr': null };
      for (const horizon of ['1yr', '3yr'] as Horizon[]) {
        const m = artifact.models?.[horizon];
        if (!m) continue;
        if (m.type === 'ridge') {
          models[horizon] = { type: 'ridge', ridge: { weights: m.weights, lambda: m.lambda } };
        } else {
          const weightData = m.weight_data_base64
            ? Buffer.from(m.weight_data_base64, 'base64').buffer
            : undefined;
          const nn = await tf.loadLayersModel(
            tf.io.fromMemory(
              m.model_topology as tf.io.ModelJSON['modelTopology'],
              m.weight_specs,
              weightData
            )
          );
          models[horizon] = { type: 'nn', nn };
        }
      }

      return {
        modelVersion: artifact.model_version,
        normContext: artifact.norm_context,
        metrics: artifact.metrics,
        models,
      };
    } catch (err) {
      console.error('[ModelTraining] Error loading model:', err);
      return null;
    }
  }

  /** Free any TF.js resources held by a loaded artifact. */
  static disposeArtifact(artifact: LoadedArtifact): void {
    for (const horizon of ['1yr', '3yr'] as Horizon[]) {
      const m = artifact.models[horizon];
      if (m?.type === 'nn') m.nn.dispose();
    }
  }

  /** Run inference for one horizon. Returns appreciation percent, or null. */
  static predictHorizon(
    artifact: LoadedArtifact,
    horizon: Horizon,
    vector: number[]
  ): number | null {
    const m = artifact.models[horizon];
    if (!m) return null;

    if (m.type === 'ridge') {
      return targetToAppreciation(predictRidge(m.ridge, vector));
    }

    const inputT = tf.tensor2d([vector]);
    const predT = m.nn.predict(inputT) as tf.Tensor2D;
    const y = predT.dataSync()[0];
    inputT.dispose();
    predT.dispose();
    return targetToAppreciation(y);
  }
}
