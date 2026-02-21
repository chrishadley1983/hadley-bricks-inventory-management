'use client';

import * as React from 'react';
import { Loader2, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { LookupProgress, LookupPhase } from '@/lib/purchase-evaluator';

interface LookupStepProps {
  progress: LookupProgress | null;
  error: string | null;
  isRunning: boolean;
}

interface PhaseStatus {
  phase: LookupPhase;
  label: string;
  status: 'pending' | 'running' | 'complete';
  percent: number;
}

/**
 * Lookup step showing progress during price lookups
 */
export function LookupStep({ progress, error, isRunning }: LookupStepProps) {
  // Track phase statuses
  const [phases, setPhases] = React.useState<PhaseStatus[]>([
    { phase: 'brickset', label: 'Brickset Set Data', status: 'pending', percent: 0 },
    { phase: 'amazon', label: 'Amazon Pricing', status: 'pending', percent: 0 },
    { phase: 'ebay', label: 'eBay Pricing', status: 'pending', percent: 0 },
  ]);

  // Update phases based on progress
  React.useEffect(() => {
    if (!progress) return;

    setPhases((current) => {
      const updated = [...current];

      // Find current phase
      const phaseIndex = updated.findIndex((p) => p.phase === progress.phase);

      // Mark previous phases as complete
      for (let i = 0; i < phaseIndex; i++) {
        updated[i].status = 'complete';
        updated[i].percent = 100;
      }

      // Update current phase
      if (phaseIndex >= 0) {
        if (progress.type === 'phase_complete') {
          updated[phaseIndex].status = 'complete';
          updated[phaseIndex].percent = 100;
        } else {
          updated[phaseIndex].status = 'running';
          updated[phaseIndex].percent = progress.percent || 0;
        }
      }

      // If complete, mark all as complete
      if (progress.type === 'complete') {
        return updated.map((p) => ({ ...p, status: 'complete' as const, percent: 100 }));
      }

      return updated;
    });
  }, [progress]);

  // Overall progress
  const overallPercent = Math.round(phases.reduce((sum, p) => sum + p.percent, 0) / phases.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Looking Up Prices
        </CardTitle>
        <CardDescription>Fetching pricing data from Brickset, Amazon, and eBay</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Overall Progress</span>
            <span className="font-medium">{overallPercent}%</span>
          </div>
          <Progress value={overallPercent} className="h-3" />
        </div>

        {/* Phase progress */}
        <div className="space-y-4">
          {phases.map((phase) => (
            <div key={phase.phase} className="space-y-2">
              <div className="flex items-center gap-2">
                {phase.status === 'complete' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : phase.status === 'running' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-muted" />
                )}
                <span
                  className={
                    phase.status === 'complete'
                      ? 'text-muted-foreground'
                      : phase.status === 'running'
                        ? 'font-medium'
                        : 'text-muted-foreground'
                  }
                >
                  {phase.label}
                </span>
                {phase.status === 'running' && progress?.currentItem && (
                  <span className="text-sm text-muted-foreground ml-auto">
                    {progress.currentItem}
                  </span>
                )}
              </div>
              <Progress
                value={phase.percent}
                className={`h-2 ${phase.status === 'complete' ? 'bg-green-100' : ''}`}
              />
            </div>
          ))}
        </div>

        {/* Current item being processed */}
        {isRunning && progress?.currentItem && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">
              Currently processing: <span className="font-medium">{progress.currentItem}</span>
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Completion message */}
        {!isRunning && !error && overallPercent === 100 && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">Complete</AlertTitle>
            <AlertDescription className="text-green-700">
              All price lookups have been completed. Proceeding to review...
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
