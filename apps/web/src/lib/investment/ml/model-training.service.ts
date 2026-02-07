/**
 * Investment Model Training Service
 *
 * Trains a TensorFlow.js neural network to predict 1yr and 3yr
 * post-retirement appreciation for LEGO sets.
 *
 * Model architecture: Simple feed-forward network with 2 hidden layers.
 * Outputs: [predicted_1yr_appreciation, predicted_3yr_appreciation]
 */

import * as tf from '@tensorflow/tfjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchTrainingSamples,
  buildNormContext,
  featuresToVector,
  getFeatureCount,
  type TrainingSample,
  type FeatureNormContext,
} from './feature-engineering';

export interface TrainingMetrics {
  mae_1yr: number;
  mae_3yr: number;
  r_squared_1yr: number;
  r_squared_3yr: number;
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

export interface ModelArtifact {
  model_json: string;
  weights_data: ArrayBuffer;
  norm_context: FeatureNormContext;
  model_version: string;
  trained_at: string;
  metrics: TrainingMetrics;
}

const MINIMUM_TRAINING_SAMPLES = 50;
const HOLDOUT_RATIO = 0.2;
const EPOCHS = 100;
const BATCH_SIZE = 32;
const LEARNING_RATE = 0.001;

export class ModelTrainingService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Train the investment prediction model.
   * Returns insufficient_data status if < 50 samples available.
   */
  async train(): Promise<TrainingResult> {
    const startTime = Date.now();

    // Fetch training data
    const samples = await fetchTrainingSamples(this.supabase);

    if (samples.length < MINIMUM_TRAINING_SAMPLES) {
      return {
        status: 'insufficient_data',
        available_samples: samples.length,
        minimum_required: MINIMUM_TRAINING_SAMPLES,
        duration_ms: Date.now() - startTime,
      };
    }

    // Shuffle samples
    const shuffled = [...samples].sort(() => Math.random() - 0.5);

    // Split into training and holdout sets
    const holdoutSize = Math.floor(shuffled.length * HOLDOUT_RATIO);
    const trainingSamples = shuffled.slice(holdoutSize);
    const holdoutSamples = shuffled.slice(0, holdoutSize);

    // Build normalisation context from training data only
    const normContext = buildNormContext(trainingSamples);

    // Convert to tensors
    const trainX = this.samplesToFeatureTensor(trainingSamples, normContext);
    const trainY = this.samplesToLabelTensor(trainingSamples);
    const model = this.buildModel();

    try {
      await model.fit(trainX, trainY, {
        epochs: EPOCHS,
        batchSize: BATCH_SIZE,
        validationSplit: 0.1,
        verbose: 0,
      });

      // Evaluate on holdout set
      const metrics = this.evaluate(model, holdoutSamples, normContext);

      // Generate model version
      const modelVersion = `v${Date.now()}`;

      // Save model artifact
      await this.saveModelArtifact(model, normContext, modelVersion, metrics);

      return {
        status: 'success',
        metrics,
        training_samples: trainingSamples.length,
        holdout_samples: holdoutSamples.length,
        model_version: modelVersion,
        duration_ms: Date.now() - startTime,
      };
    } finally {
      trainX.dispose();
      trainY.dispose();
      model.dispose();
    }
  }

  /**
   * Build the neural network architecture.
   */
  private buildModel(): tf.Sequential {
    const model = tf.sequential();
    const featureCount = getFeatureCount();

    model.add(tf.layers.dense({
      inputShape: [featureCount],
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    }));

    model.add(tf.layers.dropout({ rate: 0.1 }));

    model.add(tf.layers.dense({
      units: 2, // [1yr_appreciation, 3yr_appreciation]
      activation: 'linear',
    }));

    model.compile({
      optimizer: tf.train.adam(LEARNING_RATE),
      loss: 'meanSquaredError',
      metrics: ['mae'],
    });

    return model;
  }

  /**
   * Convert training samples to a feature tensor.
   */
  private samplesToFeatureTensor(
    samples: TrainingSample[],
    ctx: FeatureNormContext
  ): tf.Tensor2D {
    const vectors = samples.map((s) => featuresToVector(s.features, ctx));
    return tf.tensor2d(vectors);
  }

  /**
   * Convert training samples to a label tensor.
   */
  private samplesToLabelTensor(samples: TrainingSample[]): tf.Tensor2D {
    const labels = samples.map((s) => [
      s.labels.actual_1yr_appreciation,
      s.labels.actual_3yr_appreciation,
    ]);
    return tf.tensor2d(labels);
  }

  /**
   * Evaluate model on holdout set and compute metrics.
   */
  private evaluate(
    model: tf.Sequential,
    holdout: TrainingSample[],
    ctx: FeatureNormContext
  ): TrainingMetrics {
    if (holdout.length === 0) {
      return { mae_1yr: 0, mae_3yr: 0, r_squared_1yr: 0, r_squared_3yr: 0 };
    }

    const features = this.samplesToFeatureTensor(holdout, ctx);
    const predictions = model.predict(features) as tf.Tensor2D;
    const predValues = predictions.arraySync() as number[][];

    const actual1yr = holdout.map((s) => s.labels.actual_1yr_appreciation);
    const actual3yr = holdout.map((s) => s.labels.actual_3yr_appreciation);
    const pred1yr = predValues.map((p) => p[0]);
    const pred3yr = predValues.map((p) => p[1]);

    features.dispose();
    predictions.dispose();

    return {
      mae_1yr: this.meanAbsoluteError(actual1yr, pred1yr),
      mae_3yr: this.meanAbsoluteError(actual3yr, pred3yr),
      r_squared_1yr: this.rSquared(actual1yr, pred1yr),
      r_squared_3yr: this.rSquared(actual3yr, pred3yr),
    };
  }

  /**
   * Calculate Mean Absolute Error.
   */
  private meanAbsoluteError(actual: number[], predicted: number[]): number {
    const sum = actual.reduce((acc, a, i) => acc + Math.abs(a - predicted[i]), 0);
    return Math.round((sum / actual.length) * 100) / 100;
  }

  /**
   * Calculate R-squared (coefficient of determination).
   */
  private rSquared(actual: number[], predicted: number[]): number {
    const mean = actual.reduce((sum, v) => sum + v, 0) / actual.length;
    const ssRes = actual.reduce((sum, a, i) => sum + (a - predicted[i]) ** 2, 0);
    const ssTot = actual.reduce((sum, a) => sum + (a - mean) ** 2, 0);

    if (ssTot === 0) return 0;
    return Math.round((1 - ssRes / ssTot) * 10000) / 10000;
  }

  /**
   * Save the trained model and normalisation context to Supabase Storage.
   */
  private async saveModelArtifact(
    model: tf.Sequential,
    normContext: FeatureNormContext,
    modelVersion: string,
    metrics: TrainingMetrics
  ): Promise<void> {
    // Serialize model to JSON + weights
    await model.save(tf.io.withSaveHandler(async (artifacts) => {
      const weightsData = artifacts.weightData;
      const weightsSpec = artifacts.weightSpecs;

      // Store the complete artifact as JSON in the database
      // Using a simple approach: store model JSON + base64 weights in a config table
      const artifact = {
        model_topology: artifacts.modelTopology,
        weight_specs: weightsSpec,
        weight_data_base64: weightsData
          ? Buffer.from(new Uint8Array(weightsData as ArrayBuffer)).toString('base64')
          : null,
        norm_context: normContext,
        model_version: modelVersion,
        trained_at: new Date().toISOString(),
        metrics,
      };

      // Store as a sentinel row with data_quality='model_artifact'
      // so it's excluded from training queries that filter in('data_quality', ['good', 'partial'])
      const { error } = await this.supabase
        .from('investment_historical')
        .upsert(
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

      console.log(`[ModelTraining] Model ${modelVersion} saved to database`);

      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON' as const,
        },
      };
    }));

    return;
  }

  /**
   * Load a previously trained model from the database.
   * Returns null if no model exists.
   */
  static async loadModel(
    supabase: SupabaseClient
  ): Promise<{ model: tf.Sequential; normContext: FeatureNormContext; modelVersion: string } | null> {
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

    try {
      const artifact = rawData as {
        model_topology: tf.io.ModelJSON['modelTopology'];
        weight_specs: tf.io.WeightsManifestEntry[];
        weight_data_base64: string | null;
        norm_context: FeatureNormContext;
        model_version: string;
      };

      const weightData = artifact.weight_data_base64
        ? Buffer.from(artifact.weight_data_base64, 'base64').buffer
        : undefined;

      const model = (await tf.loadLayersModel(
        tf.io.fromMemory(
          artifact.model_topology,
          artifact.weight_specs,
          weightData
        )
      )) as tf.Sequential;

      return {
        model,
        normContext: artifact.norm_context,
        modelVersion: artifact.model_version,
      };
    } catch (err) {
      console.error('[ModelTraining] Error loading model:', err);
      return null;
    }
  }
}
