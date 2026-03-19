'use client';

import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { CheckCircle, CheckCircle2, XCircle, ImageIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useReviewPiece } from '@/hooks/use-scanner';
import type { ScannerPiece, BrickognizeCandidate } from '@/types/scanner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

function buildImageUrl(imagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/scanner-images/${imagePath}`;
}

// ─── Inline candidate row ─────────────────────────────────────────────────────

interface CandidateRowProps {
  candidate: BrickognizeCandidate;
  rank: number;
  onSelect: (partId: string) => void;
  isLoading: boolean;
}

function CandidateRow({ candidate, rank, onSelect, isLoading }: CandidateRowProps) {
  const partId = candidate.part_id ?? candidate.id ?? '';
  const score = candidate.score != null ? Math.round(candidate.score * 100) : null;

  return (
    <div className="flex items-center gap-3 rounded-md border p-2 text-sm">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
        {rank}
      </span>
      {candidate.img_url ? (
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded border">
          <Image
            src={candidate.img_url}
            alt={candidate.name ?? partId}
            width={40}
            height={40}
            className="h-full w-full object-cover"
            unoptimized
          />
        </div>
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border bg-muted">
          <ImageIcon className="h-3 w-3 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{candidate.name ?? '—'}</p>
        <p className="font-mono text-xs text-muted-foreground">{partId || '—'}</p>
      </div>
      {score != null && (
        <span className="shrink-0 text-xs font-semibold tabular-nums">{score}%</span>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={isLoading || !partId}
        onClick={() => onSelect(partId)}
      >
        Select
      </Button>
    </div>
  );
}

// ─── Single piece review panel (no Dialog — rendered inside the queue Dialog) ─

interface PieceReviewPanelProps {
  piece: ScannerPiece;
  onAccepted: () => void;
  onRejected: () => void;
  onSkip: () => void;
}

function PieceReviewPanel({ piece, onAccepted, onRejected, onSkip }: PieceReviewPanelProps) {
  const [manualPartId, setManualPartId] = useState('');
  const { mutate: reviewPiece, isPending } = useReviewPiece();

  const candidates = piece.top_results_json?.slice(0, 5) ?? [];
  const imageUrl = piece.image_path ? buildImageUrl(piece.image_path) : null;

  function handleSelect(partId: string) {
    reviewPiece(
      { pieceId: piece.id, input: { reviewed_item_id: partId, status: 'accepted' } },
      {
        onSuccess: () => {
          toast.success(`Piece accepted as ${partId}`);
          onAccepted();
        },
        onError: () => {
          toast.error('Failed to update piece — please select again to retry', { style: { background: '#fee2e2' } });
        },
      }
    );
  }

  function handleManualAccept() {
    const trimmed = manualPartId.trim();
    if (!trimmed) return;
    handleSelect(trimmed);
  }

  function handleReject() {
    reviewPiece(
      { pieceId: piece.id, input: { reviewed_item_id: '', status: 'rejected' } },
      {
        onSuccess: () => {
          toast.success('Piece rejected');
          onRejected();
        },
        onError: () => {
          toast.error('Failed to update piece — please select again to retry', { style: { background: '#fee2e2' } });
        },
      }
    );
  }

  return (
    <div className="space-y-4">
      {/* Piece image + current identification */}
      <div className="flex gap-4">
        <div className="shrink-0">
          {imageUrl ? (
            <div className="h-36 w-36 overflow-hidden rounded-lg border bg-muted">
              <Image
                src={imageUrl}
                alt={piece.part_id ?? 'Scanned piece'}
                width={144}
                height={144}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-36 w-36 items-center justify-center rounded-lg border bg-muted">
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Current ID</p>
            <p className="font-mono text-sm font-semibold">{piece.part_id ?? '—'}</p>
          </div>
          {piece.part_name && (
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm">{piece.part_name}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Flagged</Badge>
            {piece.confidence_score != null && (
              <span className="text-sm text-muted-foreground">
                {Math.round(piece.confidence_score * 100)}% confidence
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Candidates */}
      {candidates.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">Top Candidates</h4>
          <div className="space-y-1.5">
            {candidates.map((candidate, index) => (
              <CandidateRow
                key={index}
                candidate={candidate}
                rank={index + 1}
                onSelect={handleSelect}
                isLoading={isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Manual entry */}
      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold">Manual Part ID</h4>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. 3001"
            value={manualPartId}
            onChange={(e) => setManualPartId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualAccept()}
            disabled={isPending}
            className="font-mono"
          />
          <Button
            variant="outline"
            disabled={isPending || !manualPartId.trim()}
            onClick={handleManualAccept}
          >
            <CheckCircle className="mr-1 h-4 w-4" />
            Accept
          </Button>
        </div>
      </div>

      {/* Reject + skip */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" disabled={isPending} onClick={onSkip} aria-label="Skip this piece and review it later">
          Skip
        </Button>
        <Button variant="destructive" disabled={isPending} onClick={handleReject}>
          <XCircle className="mr-1 h-4 w-4" />
          Reject
        </Button>
      </div>
    </div>
  );
}

// ─── Main queue component ─────────────────────────────────────────────────────

interface PieceReviewQueueProps {
  pieces: ScannerPiece[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function PieceReviewQueue({
  pieces,
  open,
  onOpenChange,
  onComplete,
}: PieceReviewQueueProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const flaggedPieces = pieces.filter((p) => p.status === 'flagged');
  const total = flaggedPieces.length;
  const currentPiece = flaggedPieces[currentIndex] ?? null;
  const isDone = currentIndex >= total;

  function advanceToNext() {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= total) {
      onComplete();
    } else {
      setCurrentIndex(nextIndex);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCurrentIndex(0);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Review Queue</DialogTitle>
            {total > 0 && !isDone && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {currentIndex + 1} of {total} flagged
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Progress bar */}
        {total > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(currentIndex / total) * 100}%` }}
            />
          </div>
        )}

        {total === 0 ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              There are no flagged pieces in this session to review.
            </p>
            <Button onClick={() => handleOpenChange(false)}>Close</Button>
          </div>
        ) : isDone ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <p className="text-sm text-muted-foreground">
              All {total} flagged piece{total !== 1 ? 's' : ''} have been reviewed.
            </p>
            <Button onClick={() => handleOpenChange(false)}>Close</Button>
          </div>
        ) : (
          currentPiece && (
            <PieceReviewPanel
              key={currentPiece.id}
              piece={currentPiece}
              onAccepted={advanceToNext}
              onRejected={advanceToNext}
              onSkip={advanceToNext}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
