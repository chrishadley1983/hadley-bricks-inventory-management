'use client';

/**
 * Cost Modelling Page - Main Orchestrator Component
 * Manages scenario selection, form state, and calculations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import {
  useCostScenarios,
  useCostScenario,
  useUpdateCostScenario,
  useDraftCheck,
  useSaveDraft,
  useClearDraft,
} from '@/hooks/use-cost-modelling';
import { useCostCalculations, useComparisonDeltas } from '@/hooks/use-cost-calculations';
import type { CostModelScenarioFormData } from '@/types/cost-modelling';

import { ScenarioSelector } from './ScenarioSelector';
import { ProfitSummaryCards } from './ProfitSummaryCards';
import { AssumptionsPanel } from './AssumptionsPanel';
import { PLBreakdown } from './PLBreakdown';
import { PackageCostMatrix } from './PackageCostMatrix';
import { SummaryViewTabs } from './SummaryViewTabs';
import { CompareMode } from './CompareMode';
import { ComparisonSummary } from './ComparisonSummary';
import { ExportButtons } from './ExportButtons';
import { DraftRestorationDialog } from './DraftRestorationDialog';

/**
 * Check if form data has changed from saved state
 */
function hasChanges(
  current: CostModelScenarioFormData | null,
  saved: CostModelScenarioFormData | null
): boolean {
  if (!current || !saved) return false;
  return JSON.stringify(current) !== JSON.stringify(saved);
}

export function CostModellingPage() {
  const { toast } = useToast();

  // Scenario selection state
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [scenarioBId, setScenarioBId] = useState<string | null>(null);

  // Form state for both scenarios
  const [formDataA, setFormDataA] = useState<CostModelScenarioFormData | null>(null);
  const [formDataB, setFormDataB] = useState<CostModelScenarioFormData | null>(null);
  const [savedFormDataA, setSavedFormDataA] = useState<CostModelScenarioFormData | null>(null);

  // Draft restoration state
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<CostModelScenarioFormData | null>(null);
  const [pendingDraftTime, setPendingDraftTime] = useState<string | null>(null);

  // Track if we've checked for draft
  const draftCheckedRef = useRef(false);

  // Queries
  const { data: scenarios, isLoading: loadingScenarios } = useCostScenarios();
  const {
    data: scenarioAData,
    isLoading: loadingScenarioA,
    refetch: refetchScenarioA,
  } = useCostScenario(selectedScenarioId);
  const { data: scenarioBData, isLoading: loadingScenarioB } = useCostScenario(
    compareMode ? scenarioBId : null
  );
  const { data: draftData } = useDraftCheck(selectedScenarioId);

  // Mutations
  const updateMutation = useUpdateCostScenario();
  const saveDraftMutation = useSaveDraft();
  const clearDraftMutation = useClearDraft();

  // Calculations (memoized)
  const calculationsA = useCostCalculations(formDataA);
  const calculationsB = useCostCalculations(formDataB);
  const comparisonDeltas = useComparisonDeltas(calculationsA, calculationsB);

  // Track dirty state
  const isDirty = hasChanges(formDataA, savedFormDataA);

  // Auto-select first scenario when loaded
  useEffect(() => {
    if (scenarios && scenarios.length > 0 && !selectedScenarioId) {
      setSelectedScenarioId(scenarios[0].id);
    }
  }, [scenarios, selectedScenarioId]);

  // Load form data when scenario loads
  useEffect(() => {
    if (scenarioAData) {
      const formData = scenarioAData.formData;
      setFormDataA(formData);
      setSavedFormDataA(formData);
      draftCheckedRef.current = false; // Reset draft check for new scenario
    }
  }, [scenarioAData]);

  // Load form data for scenario B
  useEffect(() => {
    if (scenarioBData && compareMode) {
      setFormDataB(scenarioBData.formData);
    }
  }, [scenarioBData, compareMode]);

  // Check for draft after scenario loads
  useEffect(() => {
    if (draftData && !draftCheckedRef.current && selectedScenarioId && formDataA) {
      draftCheckedRef.current = true;
      if (draftData.hasDraft && draftData.draftData) {
        // F48: Show draft restoration dialog
        setPendingDraft(draftData.draftData);
        setPendingDraftTime(draftData.draftUpdatedAt);
        setShowDraftDialog(true);
      }
    }
  }, [draftData, selectedScenarioId, formDataA]);

  // F45: Unsaved changes warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // F47: Auto-save draft every 30 seconds
  useEffect(() => {
    if (!selectedScenarioId || !formDataA || !isDirty) return;

    const interval = setInterval(() => {
      if (isDirty && formDataA) {
        saveDraftMutation.mutate(
          { id: selectedScenarioId, data: formDataA },
          {
            onError: (error) => {
              console.error('Auto-save draft failed:', error);
            },
          }
        );
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [selectedScenarioId, formDataA, isDirty, saveDraftMutation]);

  // Handle form changes
  const handleFormChange = useCallback((updates: Partial<CostModelScenarioFormData>) => {
    setFormDataA((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  const handleFormBChange = useCallback((updates: Partial<CostModelScenarioFormData>) => {
    setFormDataB((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!selectedScenarioId || !formDataA) return;

    try {
      await updateMutation.mutateAsync({
        id: selectedScenarioId,
        data: {
          ...formDataA,
          knownUpdatedAt: scenarioAData?.updated_at,
        },
      });
      setSavedFormDataA(formDataA);
      toast({ title: 'Scenario saved successfully' });
      refetchScenarioA();
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Conflict')) {
          // E7: Concurrent edit warning
          toast({ title: 'This scenario was modified elsewhere. Please refresh and try again.', variant: 'destructive' });
        } else {
          // E1: API error on save
          toast({ title: error.message, variant: 'destructive' });
        }
      }
    }
  }, [selectedScenarioId, formDataA, scenarioAData, updateMutation, refetchScenarioA, toast]);

  // Handle draft restoration
  const handleRestoreDraft = useCallback(() => {
    if (pendingDraft) {
      setFormDataA(pendingDraft);
    }
    setShowDraftDialog(false);
    setPendingDraft(null);
    setPendingDraftTime(null);
  }, [pendingDraft]);

  const handleDiscardDraft = useCallback(async () => {
    if (selectedScenarioId) {
      await clearDraftMutation.mutateAsync(selectedScenarioId);
    }
    setShowDraftDialog(false);
    setPendingDraft(null);
    setPendingDraftTime(null);
  }, [selectedScenarioId, clearDraftMutation]);

  // Handle scenario selection
  const handleScenarioSelect = useCallback((id: string) => {
    setSelectedScenarioId(id);
  }, []);

  // Handle compare mode scenario B selection
  const handleScenarioBSelect = useCallback((id: string) => {
    setScenarioBId(id);
  }, []);

  // Toggle compare mode
  const handleCompareModeToggle = useCallback((enabled: boolean) => {
    setCompareMode(enabled);
    if (enabled && scenarios && scenarios.length > 1) {
      // Select first different scenario for B
      const otherScenario = scenarios.find((s) => s.id !== selectedScenarioId);
      if (otherScenario) {
        setScenarioBId(otherScenario.id);
      }
    }
  }, [scenarios, selectedScenarioId]);

  // Loading state
  if (loadingScenarios) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No scenarios (shouldn't happen due to auto-create)
  if (!scenarios || scenarios.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No scenarios found. Creating default...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cost Modelling</h1>
          <p className="text-muted-foreground">
            Create and compare financial scenarios for your business
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ScenarioSelector
            scenarios={scenarios}
            selectedId={selectedScenarioId}
            onSelect={handleScenarioSelect}
            disabled={loadingScenarioA}
          />

          <div className="flex items-center gap-2">
            <Switch
              id="compare-mode"
              checked={compareMode}
              onCheckedChange={handleCompareModeToggle}
              disabled={scenarios.length < 2}
            />
            <Label htmlFor="compare-mode" className="text-sm">
              Compare Mode
            </Label>
          </div>

          <Button
            variant="default"
            onClick={handleSave}
            disabled={!isDirty || updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
            {isDirty && <span className="ml-1 text-xs">*</span>}
          </Button>

          <ExportButtons formData={formDataA} calculations={calculationsA} />
        </div>
      </div>

      {/* Main content */}
      {compareMode ? (
        <>
          <CompareMode
            scenarios={scenarios}
            selectedScenarioAId={selectedScenarioId}
            selectedScenarioBId={scenarioBId}
            onScenarioBSelect={handleScenarioBSelect}
            formDataA={formDataA}
            formDataB={formDataB}
            calculationsA={calculationsA}
            calculationsB={calculationsB}
            onFormAChange={handleFormChange}
            onFormBChange={handleFormBChange}
            loadingA={loadingScenarioA}
            loadingB={loadingScenarioB}
          />
          {comparisonDeltas && (
            <ComparisonSummary deltas={comparisonDeltas} />
          )}
        </>
      ) : (
        <>
          {/* Hero metrics */}
          {calculationsA && formDataA && (
            <ProfitSummaryCards
              calculations={calculationsA}
              targetProfit={formDataA.targetAnnualProfit}
            />
          )}

          {/* Assumptions panel */}
          {formDataA && (
            <AssumptionsPanel
              data={formDataA}
              onChange={handleFormChange}
              disabled={loadingScenarioA}
            />
          )}

          {/* P&L Breakdown */}
          {calculationsA && formDataA && (
            <PLBreakdown
              calculations={calculationsA}
              isVatRegistered={formDataA.isVatRegistered}
            />
          )}

          {/* Package Cost Matrix */}
          {formDataA && calculationsA && (
            <PackageCostMatrix
              data={formDataA}
              fixedCostPerSale={calculationsA.fixedCostPerSale}
              onChange={handleFormChange}
            />
          )}

          {/* Summary Views */}
          {calculationsA && formDataA && (
            <SummaryViewTabs calculations={calculationsA} data={formDataA} />
          )}
        </>
      )}

      {/* Draft restoration dialog */}
      <DraftRestorationDialog
        open={showDraftDialog}
        draftTime={pendingDraftTime}
        onRestore={handleRestoreDraft}
        onDiscard={handleDiscardDraft}
      />
    </div>
  );
}
