'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  useCreateEvaluation,
  useLookupWithProgress,
  useEvaluation,
} from '@/hooks/use-purchase-evaluator';
import type {
  EvaluatorWizardStep,
  EvaluationInputItem,
  TargetPlatform,
  CostAllocationMethod,
} from '@/lib/purchase-evaluator';
import { InputStep } from './steps/InputStep';
import { ParseStep } from './steps/ParseStep';
import { LookupStep } from './steps/LookupStep';
import { ReviewStep } from './steps/ReviewStep';
import { SavedStep } from './steps/SavedStep';

/**
 * Main Purchase Evaluator Wizard Component
 *
 * Multi-step wizard for evaluating potential LEGO purchases.
 */
export function PurchaseEvaluatorWizard() {
  const router = useRouter();
  const createMutation = useCreateEvaluation();
  const lookup = useLookupWithProgress();

  // State
  const [step, setStep] = React.useState<EvaluatorWizardStep>('input');
  const [parsedItems, setParsedItems] = React.useState<EvaluationInputItem[]>([]);
  const [inputSource, setInputSource] = React.useState<'csv_upload' | 'clipboard_paste'>('csv_upload');
  const [defaultPlatform, setDefaultPlatform] = React.useState<TargetPlatform>('amazon');
  const [totalPurchasePrice, setTotalPurchasePrice] = React.useState<number | undefined>();
  const [costAllocationMethod, setCostAllocationMethod] = React.useState<CostAllocationMethod>('per_item');
  const [evaluationId, setEvaluationId] = React.useState<string | null>(null);
  const [evaluationName, setEvaluationName] = React.useState<string>('');

  // Fetch evaluation when we have an ID
  const { data: evaluation, refetch: refetchEvaluation } = useEvaluation(evaluationId);

  // Step progress indicator
  const steps: { key: EvaluatorWizardStep; label: string }[] = [
    { key: 'input', label: 'Input' },
    { key: 'parse', label: 'Preview' },
    { key: 'lookup', label: 'Lookup' },
    { key: 'review', label: 'Review' },
    { key: 'saved', label: 'Saved' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);
  const progressPercent = ((currentStepIndex + 1) / steps.length) * 100;

  // Handle parsed items from input step
  const handleItemsParsed = (items: EvaluationInputItem[], source: 'csv_upload' | 'clipboard_paste') => {
    setParsedItems(items);
    setInputSource(source);
    setStep('parse');
  };

  // Handle proceeding from parse step
  const handleParseProceed = async () => {
    try {
      // Create the evaluation
      const result = await createMutation.mutateAsync({
        name: evaluationName || undefined,
        source: inputSource,
        defaultPlatform,
        items: parsedItems,
        totalPurchasePrice,
        costAllocationMethod,
      });

      setEvaluationId(result.id);
      setStep('lookup');

      // Start the lookups
      await lookup.startLookup(result.id);

      // Move to review when done
      await refetchEvaluation();
      setStep('review');
    } catch (error) {
      console.error('Failed to create evaluation:', error);
    }
  };

  // Handle saving the evaluation
  const handleSave = async () => {
    if (!evaluationId) return;

    try {
      const response = await fetch(`/api/purchase-evaluator/${evaluationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'saved' }),
      });

      if (response.ok) {
        setStep('saved');
      }
    } catch (error) {
      console.error('Failed to save evaluation:', error);
    }
  };

  // Handle updating items (cost override, ASIN selection)
  const handleUpdateItems = async (updates: Array<{ id: string; allocatedCost?: number | null; amazonAsin?: string }>) => {
    if (!evaluationId) return;

    try {
      const response = await fetch(`/api/purchase-evaluator/${evaluationId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updates }),
      });

      if (response.ok) {
        await refetchEvaluation();
      }
    } catch (error) {
      console.error('Failed to update items:', error);
    }
  };

  // Handle recalculating costs based on current prices
  const handleRecalculateCosts = async () => {
    if (!evaluationId) return;

    try {
      const response = await fetch(`/api/purchase-evaluator/${evaluationId}/recalculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        await refetchEvaluation();
      }
    } catch (error) {
      console.error('Failed to recalculate costs:', error);
    }
  };

  // Reset wizard
  const handleReset = () => {
    setStep('input');
    setParsedItems([]);
    setInputSource('csv_upload');
    setDefaultPlatform('amazon');
    setTotalPurchasePrice(undefined);
    setCostAllocationMethod('per_item');
    setEvaluationId(null);
    setEvaluationName('');
    lookup.reset();
  };

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      {step !== 'saved' && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                {steps.slice(0, -1).map((s, i) => (
                  <span
                    key={s.key}
                    className={i <= currentStepIndex ? 'text-primary font-medium' : 'text-muted-foreground'}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step content */}
      {step === 'input' && (
        <InputStep onItemsParsed={handleItemsParsed} />
      )}

      {step === 'parse' && (
        <ParseStep
          items={parsedItems}
          onItemsChange={setParsedItems}
          evaluationName={evaluationName}
          onEvaluationNameChange={setEvaluationName}
          defaultPlatform={defaultPlatform}
          onDefaultPlatformChange={setDefaultPlatform}
          totalPurchasePrice={totalPurchasePrice}
          onTotalPurchasePriceChange={setTotalPurchasePrice}
          costAllocationMethod={costAllocationMethod}
          onCostAllocationMethodChange={setCostAllocationMethod}
          onBack={() => setStep('input')}
          onProceed={handleParseProceed}
          isLoading={createMutation.isPending}
        />
      )}

      {step === 'lookup' && (
        <LookupStep
          progress={lookup.progress}
          error={lookup.error}
          isRunning={lookup.isRunning}
        />
      )}

      {step === 'review' && evaluation && (
        <ReviewStep
          evaluation={evaluation}
          onSave={handleSave}
          onBack={() => setStep('parse')}
          onUpdateItems={handleUpdateItems}
          onRecalculateCosts={handleRecalculateCosts}
        />
      )}

      {step === 'saved' && (
        <SavedStep
          evaluationId={evaluationId}
          onNewEvaluation={handleReset}
          onViewAll={() => router.push('/purchase-evaluator')}
        />
      )}
    </div>
  );
}
