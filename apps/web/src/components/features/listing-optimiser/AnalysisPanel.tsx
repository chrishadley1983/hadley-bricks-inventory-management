'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Check,
  X,
  ChevronRight,
  ArrowRight,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Package,
} from 'lucide-react';
import type { FullAnalysisResult, ListingSuggestion } from './types';

interface AnalysisPanelProps {
  result: FullAnalysisResult | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (suggestion: ListingSuggestion) => void;
  onSkip: (suggestion: ListingSuggestion) => void;
  isApplying?: boolean;
  previousScore?: number | null;
}

/**
 * Get grade badge variant
 */
function getGradeVariant(grade: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (grade === 'A+' || grade === 'A') return 'default';
  if (grade === 'B') return 'secondary';
  return 'destructive';
}

/**
 * Get priority badge variant
 */
function getPriorityVariant(priority: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (priority === 'high') return 'destructive';
  if (priority === 'medium') return 'secondary';
  return 'outline';
}

export function AnalysisPanel({
  result,
  isOpen,
  onClose,
  onApprove,
  onSkip,
  isApplying = false,
  previousScore = null,
}: AnalysisPanelProps) {
  const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState(0);

  if (!result) return null;

  const { analysis, pricing } = result;
  const suggestions = analysis.suggestions || [];
  const currentSuggestion = suggestions[currentSuggestionIndex];
  const hasMoreSuggestions = currentSuggestionIndex < suggestions.length - 1;

  const handleApprove = () => {
    if (!currentSuggestion) return;
    onApprove(currentSuggestion);
    if (hasMoreSuggestions) {
      setCurrentSuggestionIndex((prev) => prev + 1);
    }
  };

  const handleSkip = () => {
    if (!currentSuggestion) return;
    onSkip(currentSuggestion);
    if (hasMoreSuggestions) {
      setCurrentSuggestionIndex((prev) => prev + 1);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            Listing Analysis
            <Badge variant={getGradeVariant(analysis.grade)} className="text-lg px-3 py-1">
              {analysis.grade}
            </Badge>
            <span className="text-muted-foreground font-normal">
              {analysis.score}/100
            </span>
            {previousScore !== null && previousScore !== analysis.score && (
              <span className="flex items-center text-sm text-green-600">
                <TrendingUp className="h-4 w-4 mr-1" />
                {previousScore} <ArrowRight className="h-3 w-3 mx-1" /> {analysis.score}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            Quality analysis and improvement suggestions
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Score Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Score Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScoreBar
                label="Title"
                score={analysis.breakdown.title.score}
                max={25}
                feedback={analysis.breakdown.title.feedback}
              />
              <ScoreBar
                label="Item Specifics"
                score={analysis.breakdown.itemSpecifics.score}
                max={20}
                feedback={analysis.breakdown.itemSpecifics.feedback}
              />
              <ScoreBar
                label="Description"
                score={analysis.breakdown.description.score}
                max={25}
                feedback={analysis.breakdown.description.feedback}
              />
              <ScoreBar
                label="Condition"
                score={analysis.breakdown.conditionAccuracy.score}
                max={15}
                feedback={analysis.breakdown.conditionAccuracy.feedback}
              />
              <ScoreBar
                label="SEO"
                score={analysis.breakdown.seoOptimization.score}
                max={15}
                feedback={analysis.breakdown.seoOptimization.feedback}
              />
            </CardContent>
          </Card>

          {/* Pricing Analysis */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Pricing Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Current Price</span>
                  <p className="font-medium">£{pricing.currentPrice.toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Competitor Avg</span>
                  <p className="font-medium">
                    {pricing.competitorAvgPrice
                      ? `£${pricing.competitorAvgPrice.toFixed(2)}`
                      : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Sold Avg (90d)</span>
                  <p className="font-medium">
                    {pricing.soldAvgPrice ? `£${pricing.soldAvgPrice.toFixed(2)}` : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Suggested Price</span>
                  <p className="font-medium text-primary">
                    {pricing.suggestedPrice ? `£${pricing.suggestedPrice.toFixed(2)}` : '-'}
                  </p>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Profit Estimate */}
              {pricing.costSource ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      Est. Profit
                    </span>
                    <p className="font-medium text-green-600">
                      £{pricing.profitEstimate?.toFixed(2) || '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Profit Margin</span>
                    <p className="font-medium">
                      {pricing.profitMargin?.toFixed(1) || '-'}%
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  No cost data - listing not linked to inventory
                </div>
              )}
            </CardContent>
          </Card>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  Suggestions
                  <span className="text-muted-foreground font-normal">
                    {currentSuggestionIndex + 1} of {suggestions.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {currentSuggestion ? (
                  <div className="space-y-4">
                    {/* Suggestion header */}
                    <div className="flex items-center gap-2">
                      <Badge variant={getPriorityVariant(currentSuggestion.priority)}>
                        {currentSuggestion.priority}
                      </Badge>
                      <span className="text-sm font-medium capitalize">
                        {currentSuggestion.category}
                      </span>
                      {currentSuggestion.field !== currentSuggestion.category && (
                        <>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {currentSuggestion.field}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Issue */}
                    <div className="text-sm text-muted-foreground">
                      {currentSuggestion.issue}
                    </div>

                    {/* Side by side comparison */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground uppercase">
                          Current
                        </span>
                        <div className="p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {currentSuggestion.currentValue || '(empty)'}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-green-600 uppercase">
                          Suggested
                        </span>
                        <div className="p-3 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {currentSuggestion.suggestedValue}
                        </div>
                      </div>
                    </div>

                    {/* Explanation */}
                    <div className="text-sm text-muted-foreground italic">
                      {currentSuggestion.explanation}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-3 pt-2">
                      <Button
                        variant="default"
                        onClick={handleApprove}
                        disabled={isApplying}
                        className="flex-1"
                      >
                        {isApplying ? (
                          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleSkip}
                        disabled={isApplying}
                        className="flex-1"
                      >
                        <X className="mr-2 h-4 w-4" />
                        Skip
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <Check className="h-8 w-8 mx-auto mb-2 text-green-600" />
                    All suggestions reviewed!
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Critical Issues */}
          {analysis.criticalIssues && analysis.criticalIssues.length > 0 && (
            <Card className="border-destructive">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Critical Issues
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {analysis.criticalIssues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-destructive">•</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Highlights */}
          {analysis.highlights && analysis.highlights.length > 0 && (
            <Card className="border-green-200 dark:border-green-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  Highlights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {analysis.highlights.map((highlight, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-green-600">•</span>
                      {highlight}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Score bar component
 */
function ScoreBar({
  label,
  score,
  max,
  feedback,
}: {
  label: string;
  score: number;
  max: number;
  feedback: string;
}) {
  const percentage = (score / max) * 100;
  const variant = percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">
          {score}/{max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${variant} transition-all`} style={{ width: `${percentage}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{feedback}</p>
    </div>
  );
}
