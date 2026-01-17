'use client';

import { useState, useEffect } from 'react';
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
  ChevronLeft,
  ArrowRight,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Package,
  RotateCcw,
} from 'lucide-react';
import type { FullAnalysisResult, ListingSuggestion } from './types';

interface AnalysisPanelProps {
  result: FullAnalysisResult | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (suggestion: ListingSuggestion) => void;
  onSkip: (suggestion: ListingSuggestion) => void;
  onReanalyse?: () => void;
  onAllReviewed?: () => void; // Called when user finishes reviewing all suggestions
  isApplying?: boolean;
  isReanalysing?: boolean;
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
  onReanalyse,
  onAllReviewed,
  isApplying = false,
  isReanalysing = false,
  previousScore = null,
}: AnalysisPanelProps) {
  const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState(0);
  const [hasTriggeredAllReviewed, setHasTriggeredAllReviewed] = useState(false);

  // Compute derived values (handle null result case)
  const analysis = result?.analysis;
  const pricing = result?.pricing;
  // Filter out category suggestions - they can't be applied via eBay API
  const suggestions = (analysis?.suggestions || []).filter(
    (s) => !s.field.toLowerCase().includes('category')
  );
  const currentSuggestion = suggestions[currentSuggestionIndex];
  const hasMoreSuggestions = currentSuggestionIndex < suggestions.length - 1;
  const hasPreviousSuggestions = currentSuggestionIndex > 0;
  const allReviewed = currentSuggestionIndex >= suggestions.length;

  // Reset index when result changes OR when panel opens (for re-viewing same listing)
  useEffect(() => {
    if (isOpen) {
      console.log('[AnalysisPanel] Panel opened or result changed - resetting state');
      setCurrentSuggestionIndex(0);
      setHasTriggeredAllReviewed(false);
    }
  }, [result?.reviewId, isOpen]);

  // Trigger onAllReviewed when all suggestions have been reviewed (once per session)
  // IMPORTANT: This hook must be BEFORE the early return to maintain consistent hook order
  useEffect(() => {
    if (!result) return; // Guard for when result is null

    console.log(`[AnalysisPanel] useEffect: allReviewed=${allReviewed}, suggestions.length=${suggestions.length}, hasTriggeredAllReviewed=${hasTriggeredAllReviewed}, hasOnAllReviewed=${!!onAllReviewed}`);
    if (allReviewed && suggestions.length > 0 && !hasTriggeredAllReviewed && onAllReviewed) {
      console.log('[AnalysisPanel] ALL CONDITIONS MET - Triggering onAllReviewed NOW');
      setHasTriggeredAllReviewed(true);
      onAllReviewed();
    }
  }, [result, allReviewed, suggestions.length, hasTriggeredAllReviewed, onAllReviewed]);

  // Early return AFTER all hooks
  if (!result || !analysis || !pricing) return null;

  const handleApprove = () => {
    if (!currentSuggestion) return;
    console.log(`[AnalysisPanel] Approving suggestion ${currentSuggestionIndex + 1}/${suggestions.length}`);
    onApprove(currentSuggestion);
    // Always advance to next (or past the end to show "all reviewed")
    setCurrentSuggestionIndex((prev) => {
      const next = prev + 1;
      console.log(`[AnalysisPanel] Index advancing from ${prev} to ${next}, suggestions.length=${suggestions.length}, will be allReviewed=${next >= suggestions.length}`);
      return next;
    });
  };

  const handleSkip = () => {
    if (!currentSuggestion) return;
    console.log(`[AnalysisPanel] Skipping suggestion ${currentSuggestionIndex + 1}/${suggestions.length}`);
    onSkip(currentSuggestion);
    // Always advance to next (or past the end to show "all reviewed")
    setCurrentSuggestionIndex((prev) => {
      const next = prev + 1;
      console.log(`[AnalysisPanel] Index advancing from ${prev} to ${next}, suggestions.length=${suggestions.length}, will be allReviewed=${next >= suggestions.length}`);
      return next;
    });
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
          <Card className="relative">
            {isReanalysing && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="text-sm">Updating scores...</span>
                </div>
              </div>
            )}
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
                  {!allReviewed && (
                    <span className="text-muted-foreground font-normal">
                      {currentSuggestionIndex + 1} of {suggestions.length}
                    </span>
                  )}
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
                      {hasPreviousSuggestions && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setCurrentSuggestionIndex((prev) => prev - 1)}
                          disabled={isApplying}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                      )}
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
                ) : allReviewed ? (
                  <div className="text-center py-6 text-muted-foreground">
                    {isReanalysing ? (
                      <>
                        <span className="h-8 w-8 mx-auto mb-2 animate-spin rounded-full border-4 border-primary border-t-transparent block" />
                        <p className="font-medium text-foreground">Recalculating score...</p>
                        <p className="text-sm mt-1">Analysing your changes</p>
                      </>
                    ) : (
                      <>
                        <Check className="h-8 w-8 mx-auto mb-2 text-green-600" />
                        <p>All suggestions reviewed!</p>
                        <div className="mt-4 flex gap-2 justify-center">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentSuggestionIndex(0)}
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Review Again
                          </Button>
                          {onReanalyse && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={onReanalyse}
                              disabled={isReanalysing}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Re-analyse
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    No suggestions for this listing
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

          {/* Manual Actions Required - show only when SEO feedback indicates category is WRONG */}
          {/* Check for negative phrases about category - not just any mention of the word */}
          {(() => {
            const seoFeedback = analysis.breakdown.seoOptimization.feedback.toLowerCase();
            const hasCategoryIssue =
              (seoFeedback.includes('category') &&
                (seoFeedback.includes('wrong') ||
                  seoFeedback.includes('incorrect') ||
                  seoFeedback.includes('should be') ||
                  seoFeedback.includes('needs') ||
                  seoFeedback.includes('change') ||
                  seoFeedback.includes('update'))) ||
              // Also check criticalIssues for category mentions
              analysis.criticalIssues?.some(
                (issue) =>
                  issue.toLowerCase().includes('category') &&
                  (issue.toLowerCase().includes('wrong') ||
                    issue.toLowerCase().includes('incorrect') ||
                    issue.toLowerCase().includes('should'))
              );
            return hasCategoryIssue ? (
              <Card className="border-amber-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-amber-600 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Manual Action Required
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    The listing category may need updating. Category changes cannot be applied
                    automatically and must be updated directly on eBay.
                  </p>
                  <div className="text-xs space-y-1">
                    <p>
                      <strong>19006</strong> - LEGO Complete Sets &amp; Packs (for boxed sets)
                    </p>
                    <p>
                      <strong>183448</strong> - LEGO Bricks &amp; Building Pieces (for loose
                      parts/bulk)
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null;
          })()}

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
