'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useReviewPiece } from '@/hooks/use-scanner';
import type { ScannerPiece } from '@/types/scanner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the best candidate part ID for a piece, or null if none qualifies.
 * A candidate qualifies if it has a part_id or id field.
 */
function getBestCandidatePartId(piece: ScannerPiece): string | null {
  const candidates = piece.top_results_json;
  if (!candidates || candidates.length === 0) return null;
  const best = candidates[0];
  return best.part_id ?? best.id ?? null;
}

/** Returns pieces that meet the threshold and have a usable candidate. */
function getQualifyingPieces(
  pieces: ScannerPiece[],
  threshold: number
): { piece: ScannerPiece; partId: string }[] {
  return pieces
    .filter((p) => p.status === 'flagged')
    .filter((p) => p.confidence_score != null && p.confidence_score >= threshold)
    .flatMap((p) => {
      const partId = getBestCandidatePartId(p);
      return partId ? [{ piece: p, partId }] : [];
    });
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BulkAcceptDialogProps {
  pieces: ScannerPiece[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function BulkAcceptDialog({
  pieces,
  open,
  onOpenChange,
  onComplete,
}: BulkAcceptDialogProps) {
  const [threshold, setThreshold] = useState(0.5);
  const [isConfirming, setIsConfirming] = useState(false);
  const { mutateAsync: reviewPiece } = useReviewPiece();

  const qualifying = getQualifyingPieces(pieces, threshold);
  const qualifyingCount = qualifying.length;
  const thresholdPct = Math.round(threshold * 100);

  async function handleConfirm() {
    setIsConfirming(true);

    const results = await Promise.allSettled(
      qualifying.map(({ piece, partId }) =>
        reviewPiece({
          pieceId: piece.id,
          input: { reviewed_item_id: partId, status: 'accepted' },
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    setIsConfirming(false);

    if (failed === 0) {
      toast.success(`Accepted ${succeeded} piece${succeeded !== 1 ? 's' : ''}`);
    } else if (succeeded === 0) {
      toast.error(`Failed to accept any pieces — try again`, {
        style: { background: '#fee2e2' },
      });
    } else {
      toast.warning(`Accepted ${succeeded} pieces, ${failed} failed`);
    }

    onComplete();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!isConfirming) {
      if (nextOpen) setThreshold(0.5);
      onOpenChange(nextOpen);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Accept Flagged Pieces</DialogTitle>
          <DialogDescription>
            Accept the top candidate for all flagged pieces above a confidence threshold.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Threshold slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Confidence threshold</span>
              <span className="tabular-nums font-semibold">{thresholdPct}%</span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[threshold]}
              onValueChange={(values: number[]) => setThreshold(values[0])}
              disabled={isConfirming}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-md border bg-muted/40 p-4 text-sm space-y-1">
            <p>
              <span className="font-semibold tabular-nums">{qualifyingCount}</span>{' '}
              piece{qualifyingCount !== 1 ? 's' : ''} will be accepted at &ge;{thresholdPct}%
              confidence.
            </p>
            {qualifyingCount === 0 && (
              <p className="text-muted-foreground text-xs">
                Lower the threshold to include more pieces.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={isConfirming}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={isConfirming || qualifyingCount === 0}
              onClick={handleConfirm}
            >
              {isConfirming
                ? 'Accepting…'
                : `Accept ${qualifyingCount} piece${qualifyingCount !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
