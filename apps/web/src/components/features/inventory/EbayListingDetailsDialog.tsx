'use client';

/**
 * EbayListingDetailsDialog Component
 *
 * Displays the eBay listing details including AI-generated content
 * and quality review feedback after listing creation.
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ExternalLink,
  FileText,
  BarChart3,
  CheckCircle2,
  Lightbulb,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Tag,
  List,
  Loader2,
} from 'lucide-react';
import { useListingAudit, type ListingAuditData } from '@/hooks/use-listing-audit';
import type { QualityScoreBreakdown } from '@/lib/ebay/listing-creation.types';
import { cn } from '@/lib/utils';
import { ListingImprovementChat } from './ListingImprovementChat';

interface EbayListingDetailsDialogProps {
  inventoryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
 * Loading skeleton for the dialog
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-4 py-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/**
 * Empty state when no audit data exists
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <FileText className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium">No Listing Data</h3>
      <p className="text-sm text-muted-foreground mt-1">
        No completed eBay listing audit found for this item.
      </p>
    </div>
  );
}

/**
 * Listing Content Tab
 */
function ListingContentTab({ audit }: { audit: ListingAuditData }) {
  const [showFullDescription, setShowFullDescription] = useState(false);

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Tag className="h-4 w-4" />
          Title
        </div>
        <Card>
          <CardContent className="pt-4">
            <p className="font-medium">{audit.generatedTitle || 'No title generated'}</p>
            {audit.generatedTitle && (
              <p className="text-xs text-muted-foreground mt-1">
                {audit.generatedTitle.length} characters
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <FileText className="h-4 w-4" />
          Description
        </div>
        <Card>
          <CardContent className="pt-4">
            {audit.generatedDescription ? (
              <Collapsible open={showFullDescription} onOpenChange={setShowFullDescription}>
                <div
                  className={cn(
                    'prose prose-sm max-w-none dark:prose-invert',
                    !showFullDescription && 'max-h-32 overflow-hidden'
                  )}
                  dangerouslySetInnerHTML={{ __html: audit.generatedDescription }}
                />
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="mt-2 w-full">
                    {showFullDescription ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Show Full Description
                      </>
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent />
              </Collapsible>
            ) : (
              <p className="text-muted-foreground italic">No description generated</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Item Specifics */}
      {audit.itemSpecifics && Object.keys(audit.itemSpecifics).length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <List className="h-4 w-4" />
            Item Specifics
          </div>
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(audit.itemSpecifics).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground">{key}:</span>
                    <span className="font-medium truncate ml-2" title={value}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Category */}
      {audit.categoryName && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Category</div>
          <Badge variant="secondary">
            {audit.categoryName}
            {audit.categoryId && <span className="ml-1 opacity-70">({audit.categoryId})</span>}
          </Badge>
        </div>
      )}

      {/* AI Info */}
      {(audit.aiModelUsed || audit.aiConfidenceScore !== null) && (
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {audit.aiModelUsed && <span>Generated by: {audit.aiModelUsed}</span>}
            {audit.aiConfidenceScore !== null && (
              <span>AI Confidence: {audit.aiConfidenceScore}%</span>
            )}
          </div>
        </div>
      )}
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
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
              <p className="text-xs text-muted-foreground italic">&quot;{item.feedback}&quot;</p>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Collapsible list section for highlights/suggestions/issues
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
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
 * Quality Review Tab
 */
function QualityReviewTab({ audit }: { audit: ListingAuditData }) {
  const review = audit.qualityFeedback;
  const auditId = audit.id;

  if (!review) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Loader2 className="h-8 w-8 text-muted-foreground animate-spin mb-4" />
        <h3 className="text-lg font-medium">Quality Review Pending</h3>
        <p className="text-sm text-muted-foreground mt-1">
          The quality review is still being processed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Score Card */}
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
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                )}
                <span className="text-sm">
                  {review.score >= 85
                    ? 'Publication Ready'
                    : review.score >= 65
                      ? 'Good with Improvements'
                      : 'Needs Work'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Score Breakdown */}
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

      {/* Footer */}
      <div className="pt-2 border-t text-xs text-muted-foreground text-center">
        Reviewed by {review.reviewerModel} at {new Date(review.reviewedAt).toLocaleString()}
      </div>

      {/* Chat for discussing improvements */}
      <div className="mt-4">
        <ListingImprovementChat auditId={auditId} />
      </div>
    </div>
  );
}

/**
 * Main EbayListingDetailsDialog component
 */
export function EbayListingDetailsDialog({
  inventoryId,
  open,
  onOpenChange,
}: EbayListingDetailsDialogProps) {
  const { data: audit, isLoading, error } = useListingAudit(open ? inventoryId : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-500" />
            eBay Listing Details
          </DialogTitle>
        </DialogHeader>

        {isLoading && <LoadingSkeleton />}

        {error && (
          <div className="py-8 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}

        {!isLoading && !error && !audit && <EmptyState />}

        {!isLoading && !error && audit && (
          <>
            <Tabs defaultValue="content" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="content">
                  <FileText className="h-4 w-4 mr-2" />
                  Listing Content
                </TabsTrigger>
                <TabsTrigger value="review">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Quality Review
                  {audit.qualityScore !== null && (
                    <Badge variant={getGradeVariant(audit.qualityScore)} className="ml-2 text-xs">
                      {audit.qualityScore}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="mt-4">
                <ListingContentTab audit={audit} />
              </TabsContent>

              <TabsContent value="review" className="mt-4">
                <QualityReviewTab audit={audit} />
              </TabsContent>
            </Tabs>

            <Separator className="my-4" />

            {/* Footer Actions */}
            <div className="flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                Created: {new Date(audit.createdAt).toLocaleString()}
              </div>
              <div className="flex gap-2">
                {audit.ebayListingUrl && (
                  <Button variant="outline" asChild>
                    <a href={audit.ebayListingUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open on eBay
                    </a>
                  </Button>
                )}
                <Button onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
