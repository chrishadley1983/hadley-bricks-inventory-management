'use client';

import { LivePieceCard } from './LivePieceCard';
import type { ScannerPiece } from '@/types/scanner';

interface LivePieceFeedProps {
  /** Already sorted newest-first; up to 20 pieces */
  pieces: ScannerPiece[];
}

export function LivePieceFeed({ pieces }: LivePieceFeedProps) {
  if (pieces.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed py-12 text-muted-foreground">
        Waiting for pieces…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pieces.map((piece) => (
        <LivePieceCard key={piece.id} piece={piece} />
      ))}
    </div>
  );
}
