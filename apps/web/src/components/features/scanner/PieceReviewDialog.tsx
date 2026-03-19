'use client';

import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { CheckCircle, XCircle, ImageIcon } from 'lucide-react';
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

// ─── Candidate card ───────────────────────────────────────────────────────────

interface CandidateCardProps {
  candidate: BrickognizeCandidate;
  rank: number;
  onSelect: (partId: string) => void;
  isLoading: boolean;
}

function CandidateCard({ candidate, rank, onSelect, isLoading }: CandidateCardProps) {
  const partId = candidate.part_id ?? candidate.id ?? '';
  const score = candidate.score != null ? Math.round(candidate.score * 100) : null;

  return (
    <div className="flex items-center gap-3 rounded-md border p-3 text-sm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
        {rank}
      </span>
      {candidate.img_url ? (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded border">
          <Image
            src={candidate.img_url}
            alt={candidate.name ?? partId}
            width={48}
            height={48}
            className="h-full w-full object-cover"
            unoptimized
          />
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border bg-muted">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{candidate.name ?? '—'}</p>
        <p className="font-mono text-xs text-muted-foreground">{partId || '—'}</p>
        {candidate.category && (
          <p className="text-xs text-muted-foreground">{candidate.category}</p>
        )}
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

// ─── Main component ───────────────────────────────────────────────────────────

interface PieceReviewDialogProps {
  piece: ScannerPiece;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReviewed: () => void;
}

export function PieceReviewDialog({
  piece,
  open,
  onOpenChange,
  onReviewed,
}: PieceReviewDialogProps) {
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
          onReviewed();
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
          onReviewed();
        },
        onError: () => {
          toast.error('Failed to update piece — please select again to retry', { style: { background: '#fee2e2' } });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review Piece</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Piece image + current identification */}
          <div className="flex gap-4">
            <div className="shrink-0">
              {imageUrl ? (
                <div className="h-40 w-40 overflow-hidden rounded-lg border bg-muted">
                  <Image
                    src={imageUrl}
                    alt={piece.part_id ?? 'Scanned piece'}
                    width={160}
                    height={160}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-lg border bg-muted">
                  <ImageIcon className="h-10 w-10 text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="text-xs text-muted-foreground">Current Identification</p>
                <p className="font-mono text-sm font-semibold">{piece.part_id ?? '—'}</p>
              </div>
              {piece.part_name && (
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm">{piece.part_name}</p>
                </div>
              )}
              {piece.category && (
                <div>
                  <p className="text-xs text-muted-foreground">Category</p>
                  <p className="text-sm">{piece.category}</p>
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
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Top Candidates</h4>
              <div className="space-y-2">
                {candidates.map((candidate, index) => (
                  <CandidateCard
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
          <div className="space-y-2">
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
                Accept Manual
              </Button>
            </div>
          </div>

          {/* Reject */}
          <div className="flex justify-end">
            <Button variant="destructive" disabled={isPending} onClick={handleReject}>
              <XCircle className="mr-1 h-4 w-4" />
              Reject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
