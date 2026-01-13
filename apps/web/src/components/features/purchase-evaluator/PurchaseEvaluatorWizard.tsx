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
import { usePhotoAnalysis } from '@/hooks/use-photo-analysis';
import type {
  EvaluatorWizardStep,
  EvaluationInputItem,
  TargetPlatform,
  CostAllocationMethod,
} from '@/lib/purchase-evaluator';
import {
  calculateMaxPurchasePriceAmazon,
  calculateMaxPurchasePriceEbay,
} from '@/lib/purchase-evaluator/reverse-calculations';
import type { PhotoAnalysisItem, PrimaryAnalysisModel } from '@/lib/purchase-evaluator/photo-types';
import { InputStep } from './steps/InputStep';
import { ParseStep } from './steps/ParseStep';
import { LookupStep } from './steps/LookupStep';
import { ReviewStep } from './steps/ReviewStep';
import { SavedStep } from './steps/SavedStep';
import { PhotoInputStep } from './steps/PhotoInputStep';
import { PhotoAnalysisStep } from './steps/PhotoAnalysisStep';

/**
 * Evaluation mode - determines the calculation approach
 * - cost_known: Traditional mode where purchase price is known, calculates profit
 * - max_bid: Photo mode where we calculate max purchase price from target margin
 */
export type EvaluationMode = 'cost_known' | 'max_bid';

/**
 * Extended wizard step type to include photo-specific steps
 */
export type ExtendedWizardStep = EvaluatorWizardStep | 'photo_input' | 'photo_analysis';

/**
 * Main Purchase Evaluator Wizard Component
 *
 * Multi-step wizard for evaluating potential LEGO purchases.
 * Supports two modes:
 * - Traditional mode: Upload CSV/paste data with known costs
 * - Photo mode: Analyze photos to identify items and calculate max bid
 */
export function PurchaseEvaluatorWizard() {
  const router = useRouter();
  const createMutation = useCreateEvaluation();
  const lookup = useLookupWithProgress();
  const photoAnalysis = usePhotoAnalysis();

  // Core state
  const [step, setStep] = React.useState<ExtendedWizardStep>('input');
  const [evaluationMode, setEvaluationMode] = React.useState<EvaluationMode>('cost_known');
  const [parsedItems, setParsedItems] = React.useState<EvaluationInputItem[]>([]);
  const [inputSource, setInputSource] = React.useState<'csv_upload' | 'clipboard_paste' | 'photo_analysis'>('csv_upload');
  const [defaultPlatform, setDefaultPlatform] = React.useState<TargetPlatform>('amazon');
  const [totalPurchasePrice, setTotalPurchasePrice] = React.useState<number | undefined>();
  const [costAllocationMethod, setCostAllocationMethod] = React.useState<CostAllocationMethod>('per_item');
  const [evaluationId, setEvaluationId] = React.useState<string | null>(null);
  const [evaluationName, setEvaluationName] = React.useState<string>('');

  // Photo mode state
  const [targetMarginPercent, setTargetMarginPercent] = React.useState<number>(30);
  const [primaryModel, setPrimaryModel] = React.useState<PrimaryAnalysisModel>('gemini'); // Default to Gemini Pro for better OCR
  const [useGeminiVerification, setUseGeminiVerification] = React.useState<boolean>(true);
  const [useBrickognize, setUseBrickognize] = React.useState<boolean>(true);
  const [useImageChunking, setUseImageChunking] = React.useState<boolean>(true);
  const [listingDescription, setListingDescription] = React.useState<string>('');
  const [photoAnalysisItems, setPhotoAnalysisItems] = React.useState<PhotoAnalysisItem[]>([]);

  // Fetch evaluation when we have an ID
  const { data: evaluation, refetch: refetchEvaluation } = useEvaluation(evaluationId);

  // Step progress indicator - different steps for each mode
  const traditionalSteps: { key: ExtendedWizardStep; label: string }[] = [
    { key: 'input', label: 'Input' },
    { key: 'parse', label: 'Preview' },
    { key: 'lookup', label: 'Lookup' },
    { key: 'review', label: 'Review' },
    { key: 'saved', label: 'Saved' },
  ];

  const photoSteps: { key: ExtendedWizardStep; label: string }[] = [
    { key: 'photo_input', label: 'Photos' },
    { key: 'photo_analysis', label: 'Analysis' },
    { key: 'lookup', label: 'Lookup' },
    { key: 'review', label: 'Review' },
    { key: 'saved', label: 'Saved' },
  ];

  const steps = evaluationMode === 'max_bid' ? photoSteps : traditionalSteps;
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

  // Helper to get sell price for an item
  const getSellPrice = (item: {
    userSellPriceOverride?: number | null;
    targetPlatform?: TargetPlatform;
    amazonBuyBoxPrice?: number | null;
    amazonWasPrice?: number | null;
    ebaySoldAvgPrice?: number | null;
    ebayAvgPrice?: number | null;
  }): number | null => {
    if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
      return item.userSellPriceOverride;
    }
    if (item.targetPlatform === 'ebay') {
      return item.ebaySoldAvgPrice || item.ebayAvgPrice || null;
    }
    return item.amazonBuyBoxPrice || item.amazonWasPrice || null;
  };

  // Handle saving the evaluation
  const handleSave = async () => {
    if (!evaluationId || !evaluation) return;

    try {
      // In max_bid mode, auto-allocate costs based on max purchase price
      if (evaluationMode === 'max_bid' && evaluation.items && evaluation.items.length > 0) {
        // Calculate max purchase price for each item
        const costUpdates = evaluation.items.map((item) => {
          const sellPrice = getSellPrice(item);
          if (!sellPrice || sellPrice <= 0) {
            return { id: item.id, allocatedCost: null };
          }

          const maxPrice = item.targetPlatform === 'ebay'
            ? calculateMaxPurchasePriceEbay(sellPrice, targetMarginPercent).maxPurchasePrice
            : calculateMaxPurchasePriceAmazon(sellPrice, targetMarginPercent).maxPurchasePrice;

          return { id: item.id, allocatedCost: maxPrice };
        }).filter((update) => update.allocatedCost !== null && update.allocatedCost > 0);

        // Update items with calculated costs
        if (costUpdates.length > 0) {
          const itemsResponse = await fetch(`/api/purchase-evaluator/${evaluationId}/items`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: costUpdates }),
          });
          if (!itemsResponse.ok) {
            throw new Error('Failed to update item costs');
          }
        }

        // Calculate total max purchase price for the evaluation
        const totalMaxPurchasePrice = costUpdates.reduce(
          (sum, update) => sum + (update.allocatedCost || 0),
          0
        );

        // Update evaluation with total purchase price and status
        const response = await fetch(`/api/purchase-evaluator/${evaluationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'saved',
            totalPurchasePrice: totalMaxPurchasePrice,
          }),
        });

        if (response.ok) {
          await refetchEvaluation();
          setStep('saved');
        }
      } else {
        // Traditional mode - just update status
        const response = await fetch(`/api/purchase-evaluator/${evaluationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'saved' }),
        });

        if (response.ok) {
          setStep('saved');
        }
      }
    } catch (error) {
      console.error('Failed to save evaluation:', error);
    }
  };

  // Handle updating items (cost override, ASIN selection, platform, sell price)
  const handleUpdateItems = async (updates: Array<{
    id: string;
    allocatedCost?: number | null;
    amazonAsin?: string;
    targetPlatform?: TargetPlatform;
    userSellPriceOverride?: number | null;
  }>) => {
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

  // ============================================
  // Photo Mode Handlers
  // ============================================

  // Switch to photo mode
  const handleSwitchToPhotoMode = () => {
    setEvaluationMode('max_bid');
    setStep('photo_input');
  };

  // Handle photo analysis trigger
  const handleAnalyzePhotos = async () => {
    try {
      const result = await photoAnalysis.analyzePhotos({
        primaryModel,
        useGeminiVerification,
        useBrickognize,
        useImageChunking,
        listingDescription: listingDescription || undefined,
      });

      if (result.items.length > 0) {
        setPhotoAnalysisItems(result.items);
        setStep('photo_analysis');
      }
    } catch (error) {
      console.error('Photo analysis failed:', error);
    }
  };

  // Handle proceeding from photo analysis to lookup
  const handlePhotoAnalysisProceed = async () => {
    try {
      // Convert photo analysis items to evaluation input items
      const items: EvaluationInputItem[] = photoAnalysisItems
        .filter((item) => item.setNumber && item.itemType === 'set')
        .map((item) => ({
          setNumber: item.setNumber!,
          setName: item.setName ?? undefined,
          condition: item.condition,
          quantity: item.quantity,
          // Photo analysis fields
          itemType: item.itemType,
          boxCondition: item.boxCondition ?? undefined,
          sealStatus: item.sealStatus,
          damageNotes: item.damageNotes,
          aiConfidenceScore: item.confidenceScore,
        }));

      // Create the evaluation with photo analysis metadata
      const result = await createMutation.mutateAsync({
        name: evaluationName || 'Photo Evaluation',
        source: 'photo_analysis',
        defaultPlatform,
        items,
        // Photo evaluation mode fields
        evaluationMode: 'max_bid',
        targetMarginPercent,
        photoAnalysisJson: photoAnalysis.result ?? undefined,
        listingDescription: listingDescription || undefined,
        // For photo mode, we don't have total purchase price - we calculate max bid
        totalPurchasePrice: undefined,
        costAllocationMethod: undefined,
      });

      setEvaluationId(result.id);
      setInputSource('photo_analysis');
      setStep('lookup');

      // Start the lookups
      await lookup.startLookup(result.id);

      // Move to review when done
      await refetchEvaluation();
      setStep('review');
    } catch (error) {
      console.error('Failed to create evaluation from photos:', error);
    }
  };

  // Reset wizard
  const handleReset = () => {
    // Reset mode
    setEvaluationMode('cost_known');
    setStep('input');

    // Reset traditional mode state
    setParsedItems([]);
    setInputSource('csv_upload');
    setDefaultPlatform('amazon');
    setTotalPurchasePrice(undefined);
    setCostAllocationMethod('per_item');
    setEvaluationId(null);
    setEvaluationName('');
    lookup.reset();

    // Reset photo mode state
    photoAnalysis.reset();
    setTargetMarginPercent(30);
    setPrimaryModel('gemini');
    setUseGeminiVerification(true);
    setUseBrickognize(true);
    setListingDescription('');
    setPhotoAnalysisItems([]);
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
        <InputStep
          onItemsParsed={handleItemsParsed}
          onSwitchToPhotoMode={handleSwitchToPhotoMode}
        />
      )}

      {step === 'photo_input' && (
        <PhotoInputStep
          images={photoAnalysis.images}
          onAddImages={photoAnalysis.addImages}
          onRemoveImage={photoAnalysis.removeImage}
          listingDescription={listingDescription}
          onListingDescriptionChange={setListingDescription}
          targetMarginPercent={targetMarginPercent}
          onTargetMarginChange={setTargetMarginPercent}
          defaultPlatform={defaultPlatform}
          onDefaultPlatformChange={setDefaultPlatform}
          primaryModel={primaryModel}
          onPrimaryModelChange={setPrimaryModel}
          useGeminiVerification={useGeminiVerification}
          onUseGeminiVerificationChange={setUseGeminiVerification}
          useBrickognize={useBrickognize}
          onUseBrickognizeChange={setUseBrickognize}
          useImageChunking={useImageChunking}
          onUseImageChunkingChange={setUseImageChunking}
          onAnalyze={handleAnalyzePhotos}
          isAnalyzing={photoAnalysis.isAnalyzing}
          progressMessage={photoAnalysis.progressMessage}
          canAnalyze={photoAnalysis.images.length > 0 && !photoAnalysis.isAnalyzing}
        />
      )}

      {step === 'photo_analysis' && (
        <PhotoAnalysisStep
          result={photoAnalysis.result}
          items={photoAnalysisItems}
          onItemsChange={setPhotoAnalysisItems}
          targetMarginPercent={targetMarginPercent}
          defaultPlatform={defaultPlatform}
          onBack={() => setStep('photo_input')}
          onProceed={handlePhotoAnalysisProceed}
          isLoading={createMutation.isPending}
        />
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
          evaluationMode={evaluationMode}
          targetMarginPercent={targetMarginPercent}
          onSave={handleSave}
          onBack={() => setStep(evaluationMode === 'max_bid' ? 'photo_analysis' : 'parse')}
          onUpdateItems={handleUpdateItems}
          onRecalculateCosts={handleRecalculateCosts}
        />
      )}

      {step === 'saved' && (
        <SavedStep
          evaluationId={evaluationId}
          evaluation={evaluation}
          evaluationMode={evaluationMode}
          targetMarginPercent={targetMarginPercent}
          onNewEvaluation={handleReset}
          onViewAll={() => router.push('/purchase-evaluator')}
          onUpdateActualCost={async (actualCost: number) => {
            if (!evaluationId) return;
            // Update the evaluation with the actual total purchase price
            await fetch(`/api/purchase-evaluator/${evaluationId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                totalPurchasePrice: actualCost,
                costAllocationMethod: 'equal', // Distribute equally for now
              }),
            });
            await refetchEvaluation();
          }}
        />
      )}
    </div>
  );
}
