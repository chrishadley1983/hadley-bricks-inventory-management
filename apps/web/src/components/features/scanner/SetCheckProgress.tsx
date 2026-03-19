'use client';

import { Progress } from '@/components/ui/progress';
import type { SetCheckSession, SetCheckProgress as SetCheckProgressType } from '@/types/scanner';

interface SetCheckProgressProps {
  session: SetCheckSession;
  progress: SetCheckProgressType[];
}

export function SetCheckProgress({ session, progress }: SetCheckProgressProps) {
  const found = progress.reduce(
    (sum, p) => sum + Math.min(p.found_qty, p.expected_qty),
    0
  );
  const expected = session.total_expected;
  const pct = expected > 0 ? Math.round((found / expected) * 100) : 0;

  const missingCount = progress.filter(
    (p) => !p.is_spare && p.found_qty < p.expected_qty
  ).length;

  const missingPieces = progress.reduce(
    (sum, p) => sum + (!p.is_spare ? Math.max(0, p.expected_qty - p.found_qty) : 0),
    0
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {found} / {expected} parts found
        </span>
        <span className="font-semibold">{pct}%</span>
      </div>
      <Progress value={pct} className="h-3" />
      <div className="flex gap-6 text-sm text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{session.total_unique}</span> unique combos
        </span>
        <span>
          <span className="font-medium text-foreground">{session.spare_count}</span> spares
        </span>
        {missingCount > 0 && (
          <span className="text-destructive">
            <span className="font-medium">{missingCount}</span> part types missing (
            {missingPieces} pieces)
          </span>
        )}
        {missingCount === 0 && progress.length > 0 && (
          <span className="text-green-600 font-medium">Complete!</span>
        )}
      </div>
    </div>
  );
}
