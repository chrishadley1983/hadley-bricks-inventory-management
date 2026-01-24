'use client';

import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface PartoutProgressProps {
  fetched: number;
  total: number;
  cached?: number;
}

/**
 * PartoutProgress Component
 *
 * Displays a progress bar when loading part-out data from BrickLink.
 * Shows "BrickLink Part Data being pulled" with "X of Y parts" counter.
 */
export function PartoutProgress({ fetched, total, cached = 0 }: PartoutProgressProps) {
  const percent = total > 0 ? Math.round((fetched / total) * 100) : 0;

  return (
    <Card>
      <CardContent className="py-8 space-y-4">
        <div className="flex items-center justify-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          <span className="text-lg font-medium">BrickLink Part Data being pulled</span>
        </div>

        <Progress value={percent} className="h-3" />

        <div className="text-center text-sm text-muted-foreground">
          {fetched} of {total} parts
          {cached > 0 && <span className="ml-1">({cached} from cache)</span>}
        </div>
      </CardContent>
    </Card>
  );
}
