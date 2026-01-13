'use client';

import * as React from 'react';
import { CheckCircle2, Plus, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface SavedStepProps {
  evaluationId: string | null;
  onNewEvaluation: () => void;
  onViewAll: () => void;
}

/**
 * Final step showing success message after saving
 */
export function SavedStep({ evaluationId: _evaluationId, onNewEvaluation, onViewAll }: SavedStepProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center p-12">
        <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <p className="text-lg font-medium">Evaluation Saved!</p>
        <p className="text-muted-foreground mb-6 text-center">
          Your purchase evaluation has been saved. You can view it anytime from your evaluations list.
        </p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={onNewEvaluation}>
            <Plus className="mr-2 h-4 w-4" />
            New Evaluation
          </Button>
          <Button onClick={onViewAll}>
            <List className="mr-2 h-4 w-4" />
            View All Evaluations
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
