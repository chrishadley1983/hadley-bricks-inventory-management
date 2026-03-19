'use client';

import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScannerStatusBadge } from './ScannerStatusBadge';
import type { ScannerPiece } from '@/types/scanner';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

function buildImageUrl(imagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/scanner-images/${imagePath}`;
}

function confidenceColor(score: number): string {
  if (score >= 0.8) return 'bg-green-500';
  if (score >= 0.5) return 'bg-yellow-500';
  return 'bg-red-500';
}

interface LivePieceCardProps {
  piece: ScannerPiece;
}

export function LivePieceCard({ piece }: LivePieceCardProps) {
  const confidencePct = piece.confidence_score != null ? Math.round(piece.confidence_score * 100) : null;
  const top3 = piece.top_results_json?.slice(0, 3) ?? [];

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-3 p-3">
        {/* Thumbnail */}
        <div className="flex-shrink-0">
          {piece.image_path ? (
            <div className="relative h-16 w-16 overflow-hidden rounded border bg-muted">
              <Image
                src={buildImageUrl(piece.image_path)}
                alt={piece.part_name ?? 'Scanned piece'}
                width={64}
                height={64}
                className="h-full w-full object-cover"
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded border bg-muted">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium leading-tight">
                {piece.part_name ?? 'Unknown part'}
              </p>
              {piece.part_id && (
                <p className="text-xs text-muted-foreground">{piece.part_id}</p>
              )}
            </div>
            <ScannerStatusBadge status={piece.status} />
          </div>

          {/* Confidence bar */}
          {confidencePct != null && (
            <div className="flex items-center gap-2">
              <Progress
                value={confidencePct}
                className={`h-1.5 flex-1 [&>div]:${confidenceColor(piece.confidence_score!)}`}
              />
              <span className="w-9 text-right text-xs text-muted-foreground">
                {confidencePct}%
              </span>
            </div>
          )}

          {/* Top candidates */}
          {top3.length > 0 && (
            <div className="space-y-0.5">
              {top3.map((candidate, i) => (
                <p key={i} className="truncate text-xs text-muted-foreground">
                  {i + 1}. {candidate.name ?? candidate.part_id ?? 'Unknown'}
                  {candidate.score != null && (
                    <span className="ml-1 opacity-60">({Math.round(candidate.score * 100)}%)</span>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
