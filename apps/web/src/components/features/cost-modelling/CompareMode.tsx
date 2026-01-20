/**
 * Compare Mode Component
 * F35-F38, F43: Side-by-side scenario comparison
 */

'use client';

import { Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ProfitSummaryCards } from './ProfitSummaryCards';
import { AssumptionsPanel } from './AssumptionsPanel';
import { PLBreakdown } from './PLBreakdown';
import type {
  CostModelScenarioFormData,
  CalculatedResults,
  ScenarioListItem,
  ComparisonDelta,
} from '@/types/cost-modelling';

interface CompareModeProps {
  scenarios: ScenarioListItem[];
  selectedScenarioAId: string | null;
  selectedScenarioBId: string | null;
  onScenarioBSelect: (id: string) => void;
  formDataA: CostModelScenarioFormData | null;
  formDataB: CostModelScenarioFormData | null;
  calculationsA: CalculatedResults | null;
  calculationsB: CalculatedResults | null;
  onFormAChange: (updates: Partial<CostModelScenarioFormData>) => void;
  onFormBChange: (updates: Partial<CostModelScenarioFormData>) => void;
  loadingA: boolean;
  loadingB: boolean;
  deltas?: ComparisonDelta[] | null;
}

export function CompareMode({
  scenarios,
  selectedScenarioAId,
  selectedScenarioBId,
  onScenarioBSelect,
  formDataA,
  formDataB,
  calculationsA,
  calculationsB,
  onFormAChange,
  onFormBChange,
  loadingA,
  loadingB,
  deltas,
}: CompareModeProps) {
  // F37: Filter out currently selected scenario A from scenario B options
  const scenarioBOptions = scenarios.filter((s) => s.id !== selectedScenarioAId);

  // Get scenario A name
  const scenarioAName = scenarios.find((s) => s.id === selectedScenarioAId)?.name || 'Scenario A';

  return (
    <div className="space-y-6">
      {/* F36: Two-column layout - stacks on mobile (F50) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scenario A Column */}
        <div className="space-y-6 border-r-0 lg:border-r lg:pr-6">
          <div className="flex items-center gap-2 h-9">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <h3 className="text-lg font-semibold">{scenarioAName}</h3>
            <span className="text-xs text-muted-foreground">(Scenario A)</span>
          </div>

          {loadingA ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {calculationsA && formDataA && (
                <ProfitSummaryCards
                  calculations={calculationsA}
                  targetProfit={formDataA.targetAnnualProfit}
                  comparisonDeltas={deltas}
                  scenarioLabel="A"
                />
              )}

              {formDataA && (
                <AssumptionsPanel
                  data={formDataA}
                  onChange={onFormAChange}
                  disabled={loadingA}
                  compact
                />
              )}

              {calculationsA && formDataA && (
                <PLBreakdown
                  calculations={calculationsA}
                  isVatRegistered={formDataA.isVatRegistered}
                  compact
                />
              )}
            </>
          )}
        </div>

        {/* Scenario B Column */}
        <div className="space-y-6 lg:pl-6">
          <div className="flex items-center gap-3 h-9">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <Label htmlFor="scenario-b-select" className="text-lg font-semibold">
              Scenario B
            </Label>
            <Select value={selectedScenarioBId || ''} onValueChange={onScenarioBSelect}>
              <SelectTrigger id="scenario-b-select" className="w-[200px]">
                <SelectValue placeholder="Select scenario..." />
              </SelectTrigger>
              <SelectContent>
                {scenarioBOptions.map((scenario) => (
                  <SelectItem key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingB ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : selectedScenarioBId && formDataB ? (
            <>
              {calculationsB && (
                <ProfitSummaryCards
                  calculations={calculationsB}
                  targetProfit={formDataB.targetAnnualProfit}
                  comparisonDeltas={deltas}
                  scenarioLabel="B"
                />
              )}

              <AssumptionsPanel
                data={formDataB}
                onChange={onFormBChange}
                disabled={loadingB}
                compact
              />

              {calculationsB && (
                <PLBreakdown
                  calculations={calculationsB}
                  isVatRegistered={formDataB.isVatRegistered}
                  compact
                />
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-64 border rounded-lg bg-muted/20">
              <p className="text-muted-foreground">Select a scenario to compare</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
