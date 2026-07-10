export {
  fetchTrainingSamples,
  fetchThemeAverages,
  buildNormContext,
  featuresToVector,
  getFeatureCount,
  winsorizeAppreciation,
  appreciationToTarget,
  targetToAppreciation,
  APPRECIATION_FLOOR_PCT,
  APPRECIATION_CEIL_PCT,
  type RawFeatures,
  type TrainingSample,
  type FeatureNormContext,
  type NormStats,
} from './feature-engineering';

export { fitRidge, predictRidge, type RidgeModel } from './ridge';

export {
  ModelTrainingService,
  ARTIFACT_VERSION,
  type TrainingMetrics,
  type TrainingResult,
  type HorizonMetrics,
  type Horizon,
  type LoadedArtifact,
  type LoadedHorizonModel,
} from './model-training.service';
