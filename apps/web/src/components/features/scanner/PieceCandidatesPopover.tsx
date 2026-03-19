'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import type { BrickognizeCandidate } from '@/types/scanner';

interface PieceCandidatesPopoverProps {
  partId: string | null | undefined;
  candidates: BrickognizeCandidate[] | null | undefined;
}

export function PieceCandidatesPopover({ partId, candidates }: PieceCandidatesPopoverProps) {
  if (!partId) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  const topCandidates = candidates?.slice(0, 5) ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" className="h-auto p-0 font-mono text-sm">
          {partId}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Top Candidates</h4>
          {topCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No candidates available</p>
          ) : (
            <div className="space-y-2">
              {topCandidates.map((candidate, index) => {
                const score = candidate.score != null ? (candidate.score * 100).toFixed(1) : null;

                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-md border p-2 text-sm"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{candidate.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{candidate.id}</p>
                    </div>
                    {score != null && (
                      <span className="shrink-0 text-xs text-muted-foreground">{score}%</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
