'use client';

/**
 * QualityReviewPopup Component
 *
 * Displays the quality review progress and results in a popup dialog.
 * Polls the API while review is pending and shows detailed breakdown when complete.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  BarChart3,
  Lightbulb,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { useQualityReview } from '@/hooks/use-quality-review';
import type { QualityReviewResult, QualityScoreBreakdown } from '@/lib/ebay/listing-creation.types';
import { cn } from '@/lib/utils';

interface QualityReviewPopupProps {
  auditId: string | null;
  listingUrl: string;
  onClose: () => void;
  isOpen: boolean;
}

/**
 * Get grade badge variant based on score
 */
function getGradeVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 85) return 'default';
  if (score >= 65) return 'secondary';
  return 'destructive';
}

/**
 * Get status text based on score
 */
function getStatusText(score: number): string {
  if (score >= 85) return 'Publication Ready';
  if (score >= 65) return 'Good with Improvements';
  return 'Needs Work';
}

/**
 * Get progress bar color class based on score percentage
 */
function getProgressColorClass(score: number, max: number): string {
  const percentage = (score / max) * 100;
  if (percentage >= 85) return '[&>div]:bg-green-500';
  if (percentage >= 65) return '[&>div]:bg-yellow-500';
  return '[&>div]:bg-red-500';
}

/**
 * Score category configuration
 */
const SCORE_CATEGORIES: Array<{
  key: keyof QualityScoreBreakdown;
  label: string;
  maxScore: number;
}> = [
  { key: 'title', label: 'Title', maxScore: 25 },
  { key: 'itemSpecifics', label: 'Item Specifics', maxScore: 20 },
  { key: 'description', label: 'Description', maxScore: 25 },
  { key: 'conditionAccuracy', label: 'Condition Accuracy', maxScore: 15 },
  { key: 'seoOptimization', label: 'SEO Optimization', maxScore: 15 },
];

/**
 * Loading state component
 */
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="relative">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <Sparkles className="h-5 w-5 text-yellow-500 absolute -top-1 -right-1 animate-pulse" />
      </div>
      <div className="text-center space-y-2">
        <p className="text-lg font-medium">Analyzing Your Listing</p>
        <p className="text-sm text-muted-foreground">
          AI is reviewing title, description, item specifics, and SEO...
        </p>
        <p className="text-xs text-muted-foreground">
          This typically takes 30-60 seconds
        </p>
      </div>
    </div>
  );
}

/**
 * Error state component
 */
function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <div className="text-center space-y-2">
        <p className="text-lg font-medium">Review Failed</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        <RefreshCw className="h-4 w-4 mr-2" />
        Retry Review
      </Button>
    </div>
  );
}

/**
 * Score breakdown section
 */
function ScoreBreakdownSection({ breakdown }: { breakdown: QualityScoreBreakdown }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left hover:bg-muted/50 rounded px-2 -mx-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-blue-500" />
          <span className="font-medium">Score Breakdown</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {SCORE_CATEGORIES.map(({ key, label, maxScore }) => {
          const item = breakdown[key];
          const percentage = (item.score / maxScore) * 100;

          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <span className="font-medium">
                  {item.score}/{maxScore}
                </span>
              </div>
              <Progress
                value={percentage}
                className={cn('h-2', getProgressColorClass(item.score, maxScore))}
              />
              <p className="text-xs text-muted-foreground italic">
                &quot;{item.feedback}&quot;
              </p>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Collapsible list section
 */
function ListSection({
  title,
  items,
  icon: Icon,
  iconColor,
  emptyMessage,
  defaultOpen = false,
}: {
  title: string;
  items: string[];
  icon: React.ElementType;
  iconColor: string;
  emptyMessage: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left hover:bg-muted/50 rounded px-2 -mx-2">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', iconColor)} />
          <span className="font-medium">{title}</span>
          {items.length > 0 && (
            <Badge variant="secondary" className="h-5 text-xs">
              {items.length}
            </Badge>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pl-6">
        {items.length > 0 ? (
          <ul className="space-y-1">
            {items.map((item, index) => (
              <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="text-muted-foreground/50">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Review results component
 */
function ReviewResults({
  review,
  listingUrl,
  onClose,
}: {
  review: QualityReviewResult;
  listingUrl: string;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Header with grade and score */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center justify-center bg-muted rounded-lg p-4 min-w-[80px]">
              <Badge
                variant={getGradeVariant(review.score)}
                className="text-2xl font-bold px-4 py-2"
              >
                {review.grade}
              </Badge>
              <span className="text-xs text-muted-foreground mt-1">Grade</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-3xl font-bold">{review.score}</span>
                <span className="text-lg text-muted-foreground">/100</span>
              </div>
              <div className="flex items-center gap-2">
                {review.score >= 85 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                )}
                <span className="text-sm">{getStatusText(review.score)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Score breakdown */}
      <ScoreBreakdownSection breakdown={review.breakdown} />

      <Separator />

      {/* Highlights */}
      <ListSection
        title="Highlights"
        items={review.highlights}
        icon={CheckCircle2}
        iconColor="text-green-500"
        emptyMessage="No highlights recorded"
        defaultOpen={true}
      />

      {/* Suggestions */}
      <ListSection
        title="Suggestions"
        items={review.suggestions}
        icon={Lightbulb}
        iconColor="text-blue-500"
        emptyMessage="No suggestions - looking great!"
        defaultOpen={review.suggestions.length > 0}
      />

      {/* Issues */}
      <ListSection
        title="Issues"
        items={review.issues}
        icon={AlertTriangle}
        iconColor="text-red-500"
        emptyMessage="No critical issues found"
        defaultOpen={review.issues.length > 0}
      />

      <Separator />

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" asChild>
          <a href={listingUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            View on eBay
          </a>
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>

      {/* Footer with timestamp */}
      <p className="text-xs text-muted-foreground text-center">
        Reviewed by {review.reviewerModel} at{' '}
        {new Date(review.reviewedAt).toLocaleString()}
      </p>
    </div>
  );
}

/**
 * Main QualityReviewPopup component
 */
export function QualityReviewPopup({
  auditId,
  listingUrl,
  onClose,
  isOpen,
}: QualityReviewPopupProps) {
  const { status, review, error, retry } = useQualityReview(isOpen ? auditId : null);

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Quality Review
          </DialogTitle>
        </DialogHeader>

        {status === 'pending' && <LoadingState />}
        {status === 'failed' && <ErrorState error={error || 'Unknown error'} onRetry={retry} />}
        {status === 'completed' && review && (
          <ReviewResults review={review} listingUrl={listingUrl} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
