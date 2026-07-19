/**
 * bl-store-report — the common BL store decision-report module (2026-07-19).
 *
 * EVERY BL store review surface — skills (bl-basket, store-assessment, nightly
 * sweep) AND ad-hoc conversational queries — renders through this module.
 * CLI entry point over persisted data: `npx tsx scripts/store-report.ts`.
 */
export * from './types';
export {
  buildDecisionReport, buildBasketDecisionReport, fromScoredLot, fromBasketItem,
  cappedUnits, buildSummary, CEILING_WARN_SHARE, type BasketLensItem,
} from './compute';
export { renderDecisionCli } from './render-cli';
export { renderDecisionMd } from './render-md';
