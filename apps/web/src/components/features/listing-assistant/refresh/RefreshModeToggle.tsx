'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, Zap } from 'lucide-react';

interface RefreshModeToggleProps {
  reviewMode: boolean;
  onReviewModeChange: (reviewMode: boolean) => void;
  disabled?: boolean;
}

/**
 * Toggle between review mode (review each listing before processing) and immediate mode
 */
export function RefreshModeToggle({
  reviewMode,
  onReviewModeChange,
  disabled = false,
}: RefreshModeToggleProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {reviewMode ? (
                <AlertCircle className="h-4 w-4 text-amber-500" />
              ) : (
                <Zap className="h-4 w-4 text-blue-500" />
              )}
              <Label htmlFor="review-mode" className="font-medium">
                {reviewMode ? 'Review Mode' : 'Immediate Mode'}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              {reviewMode
                ? 'Review and optionally edit each listing before processing'
                : 'Process all selected listings immediately without review'}
            </p>
          </div>
          <Switch
            id="review-mode"
            checked={reviewMode}
            onCheckedChange={onReviewModeChange}
            disabled={disabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}
