/**
 * Cost Calculations Hook
 * Memoized hook for calculating P&L projections from form data
 *
 * P2: All calculations complete within 50ms
 */

import { useMemo } from 'react';
import { calculateAll, calculateComparisonDeltas } from '@/lib/services/cost-calculations';
import type {
  CostModelScenarioFormData,
  CalculatedResults,
  ComparisonDelta,
} from '@/types/cost-modelling';

/**
 * Hook to calculate P&L from form data
 * F24: Live calculation on input change
 */
export function useCostCalculations(
  formData: CostModelScenarioFormData | null
): CalculatedResults | null {
  return useMemo(() => {
    if (!formData) return null;
    return calculateAll(formData);
  }, [formData]);
}

/**
 * Hook to calculate comparison deltas between two scenarios
 * F41: Delta calculations for comparison mode
 */
export function useComparisonDeltas(
  calculationsA: CalculatedResults | null,
  calculationsB: CalculatedResults | null
): ComparisonDelta[] | null {
  return useMemo(() => {
    if (!calculationsA || !calculationsB) return null;
    return calculateComparisonDeltas(calculationsA, calculationsB);
  }, [calculationsA, calculationsB]);
}
