'use client';

/**
 * Listing Preview Screen
 *
 * Displays a preview of the generated eBay listing with quality score
 * and allows the user to edit fields before confirming publication.
 *
 * Part of the pre-publish quality loop feature.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle2, AlertCircle, Edit3, Eye, Sparkles, AlertTriangle } from 'lucide-react';
import type { AIGeneratedListing, QualityReviewResult } from '@/lib/ebay/listing-creation.types';
import { formatCurrency } from '@/lib/utils';

interface ListingPreviewScreenProps {
  /** The generated listing to preview */
  listing: AIGeneratedListing;
  /** Quality review result */
  qualityReview: QualityReviewResult | null;
  /** Item price */
  price: number;
  /** Photo URLs for preview */
  photoUrls: string[];
  /** Whether the quality review is still loading */
  isReviewLoading?: boolean;
  /** Whether the review failed (show error state) */
  reviewError?: string | null;
  /** Callback when user confirms the listing */
  onConfirm: (editedListing: AIGeneratedListing) => void;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Whether confirm is in progress */
  isConfirming?: boolean;
}

/**
 * Get badge variant based on quality score
 */
function getScoreBadgeVariant(score: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (score >= 90) return 'default'; // Green-ish
  if (score >= 75) return 'secondary'; // Neutral
  if (score >= 50) return 'outline'; // Warning-ish
  return 'destructive'; // Red
}

/**
 * Get grade color class
 */
function getGradeColorClass(grade: string): string {
  switch (grade) {
    case 'A+':
    case 'A':
      return 'text-green-600 dark:text-green-400';
    case 'B':
      return 'text-blue-600 dark:text-blue-400';
    case 'C':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'D':
      return 'text-orange-600 dark:text-orange-400';
    case 'F':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-muted-foreground';
  }
}

export function ListingPreviewScreen({
  listing,
  qualityReview,
  price,
  photoUrls,
  isReviewLoading = false,
  reviewError = null,
  onConfirm,
  onCancel,
  isConfirming = false,
}: ListingPreviewScreenProps) {
  // Editable state
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(listing.title);
  const [editedDescription, setEditedDescription] = useState(listing.description);
  const [editedConditionDescription, setEditedConditionDescription] = useState(
    listing.conditionDescription ?? ''
  );

  // Sync state when listing prop changes (e.g., after quality review updates the listing)
  useEffect(() => {
    setEditedTitle(listing.title);
    setEditedDescription(listing.description);
    setEditedConditionDescription(listing.conditionDescription ?? '');
  }, [listing.title, listing.description, listing.conditionDescription]);

  // Character count helpers
  const titleLength = editedTitle.length;
  const titleMaxLength = 80;
  const isTitleValid = titleLength > 0 && titleLength <= titleMaxLength;

  /**
   * Handle confirm with any edits applied
   */
  const handleConfirm = useCallback(() => {
    const editedListing: AIGeneratedListing = {
      ...listing,
      title: editedTitle,
      description: editedDescription,
      conditionDescription: editedConditionDescription || null,
    };
    onConfirm(editedListing);
  }, [listing, editedTitle, editedDescription, editedConditionDescription, onConfirm]);

  /**
   * Reset edits to original values
   */
  const handleResetEdits = useCallback(() => {
    setEditedTitle(listing.title);
    setEditedDescription(listing.description);
    setEditedConditionDescription(listing.conditionDescription ?? '');
    setIsEditing(false);
  }, [listing]);

  // Ref for contentEditable div
  const descriptionRef = useRef<HTMLDivElement>(null);

  // Sync contentEditable changes to state
  const handleDescriptionInput = useCallback(() => {
    if (descriptionRef.current) {
      setEditedDescription(descriptionRef.current.innerHTML);
    }
  }, []);

  // Update contentEditable when entering edit mode OR when the ref becomes available (tab switch)
  // We use a callback ref pattern to handle the tab unmount/remount
  const setDescriptionRef = useCallback(
    (node: HTMLDivElement | null) => {
      descriptionRef.current = node;
      // Only set content on initial mount (empty node), not on re-renders from typing
      // This prevents cursor jumping to start on every keystroke
      if (node && isEditing && node.innerHTML === '') {
        node.innerHTML = editedDescription;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Only set initial content, not on every edit
    },
    [isEditing]
  );

  return (
    <div className="space-y-4">
      {/* Quality Score Banner */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              Quality Review
            </CardTitle>
            {qualityReview && (
              <div className="flex items-center gap-2">
                <Badge variant={getScoreBadgeVariant(qualityReview.score)}>
                  {qualityReview.score}/100
                </Badge>
                <span className={`text-2xl font-bold ${getGradeColorClass(qualityReview.grade)}`}>
                  {qualityReview.grade}
                </span>
              </div>
            )}
            {isReviewLoading && (
              <Badge variant="outline">
                <span className="animate-pulse">Reviewing...</span>
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Review Error State (E1) */}
          {reviewError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Quality Review Failed</AlertTitle>
              <AlertDescription>
                {reviewError}. You can still proceed with publishing.
              </AlertDescription>
            </Alert>
          )}

          {/* Quality Breakdown */}
          {qualityReview && !reviewError && (
            <div className="space-y-3">
              {/* Score breakdown */}
              <div className="grid grid-cols-5 gap-2 text-xs">
                {Object.entries(qualityReview.breakdown).map(([key, value]) => {
                  // Get max score for each category
                  const maxScore =
                    key === 'title' || key === 'description'
                      ? 25
                      : key === 'itemSpecifics'
                        ? 20
                        : 15;
                  // Use percentage threshold (75%) for consistent coloring across categories
                  const isGood = value.score >= maxScore * 0.75;
                  return (
                    <div key={key} className="text-center">
                      <div className="font-medium capitalize">
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </div>
                      <div className={isGood ? 'text-green-600' : 'text-orange-600'}>
                        {value.score}/{maxScore}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Issues and Suggestions */}
              {qualityReview.issues.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Issues to Fix
                  </div>
                  <ul className="text-xs text-muted-foreground list-disc list-inside">
                    {qualityReview.issues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {qualityReview.highlights.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Done Well
                  </div>
                  <ul className="text-xs text-muted-foreground list-disc list-inside">
                    {qualityReview.highlights.slice(0, 3).map((highlight, idx) => (
                      <li key={idx}>{highlight}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Listing Preview with Edit Toggle */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              {isEditing ? (
                <>
                  <Edit3 className="h-5 w-5" />
                  Edit Listing
                </>
              ) : (
                <>
                  <Eye className="h-5 w-5" />
                  Preview
                </>
              )}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (isEditing ? handleResetEdits() : setIsEditing(true))}
            >
              {isEditing ? 'Cancel Edit' : 'Edit'}
            </Button>
          </div>
          <CardDescription>
            {formatCurrency(price)} • {listing.sku}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="content" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="specifics">Item Specifics</TabsTrigger>
              <TabsTrigger value="photos">Photos</TabsTrigger>
            </TabsList>

            {/* Content Tab */}
            <TabsContent value="content" className="space-y-4 pt-4">
              {/* Title */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="title">Title</Label>
                  <span
                    className={`text-xs ${
                      isTitleValid ? 'text-muted-foreground' : 'text-destructive'
                    }`}
                  >
                    {titleLength}/{titleMaxLength}
                  </span>
                </div>
                {isEditing ? (
                  <Input
                    id="title"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    maxLength={titleMaxLength}
                    className={!isTitleValid ? 'border-destructive' : ''}
                  />
                ) : (
                  <div className="p-2 bg-muted rounded-md text-sm">{editedTitle}</div>
                )}
              </div>

              {/* Condition Description */}
              <div className="space-y-2">
                <Label htmlFor="conditionDescription">Condition Description</Label>
                {isEditing ? (
                  <Textarea
                    id="conditionDescription"
                    value={editedConditionDescription}
                    onChange={(e) => setEditedConditionDescription(e.target.value)}
                    rows={2}
                    placeholder="Describe the item's condition..."
                  />
                ) : (
                  <div className="p-2 bg-muted rounded-md text-sm">
                    {editedConditionDescription || (
                      <span className="text-muted-foreground italic">No condition description</span>
                    )}
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                {isEditing ? (
                  <div
                    ref={setDescriptionRef}
                    contentEditable
                    onInput={handleDescriptionInput}
                    className="p-2 bg-background border rounded-md text-sm min-h-[200px] max-h-[400px] overflow-y-auto prose prose-sm dark:prose-invert focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    suppressContentEditableWarning
                  />
                ) : (
                  <div
                    className="p-2 bg-muted rounded-md text-sm max-h-48 overflow-y-auto prose prose-sm dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: editedDescription }}
                  />
                )}
              </div>
            </TabsContent>

            {/* Item Specifics Tab */}
            <TabsContent value="specifics" className="pt-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(listing.itemSpecifics)
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="font-medium text-muted-foreground">{key}:</span>
                      <span>{value}</span>
                    </div>
                  ))}
              </div>
            </TabsContent>

            {/* Photos Tab */}
            <TabsContent value="photos" className="pt-4">
              <div className="grid grid-cols-4 gap-2">
                {photoUrls.map((url, idx) => (
                  <div key={idx} className="relative aspect-square">
                    <img
                      src={url}
                      alt={`Photo ${idx + 1}`}
                      className="rounded-md object-cover w-full h-full"
                    />
                    {idx === 0 && (
                      <Badge className="absolute bottom-1 left-1" variant="secondary">
                        Primary
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} disabled={isConfirming}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={isConfirming || !isTitleValid}>
          {isConfirming ? (
            <>
              <span className="animate-spin mr-2">⏳</span>
              Publishing...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirm & Publish
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
