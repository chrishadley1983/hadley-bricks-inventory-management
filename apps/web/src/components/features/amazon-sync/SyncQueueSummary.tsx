'use client';

import { Package, Layers, Hash, PoundSterling } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { AggregatedQueueItem } from '@/lib/amazon/amazon-sync.types';

interface SyncQueueSummaryProps {
  totalItems: number;
  uniqueAsins: number;
  totalQuantity: number;
  totalUploadValue: number;
  aggregated: AggregatedQueueItem[];
}

export function SyncQueueSummary({
  totalItems,
  uniqueAsins,
  totalQuantity,
  totalUploadValue,
}: SyncQueueSummaryProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Queue Items</p>
              <p className="text-2xl font-bold">{totalItems}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <Layers className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unique ASINs</p>
              <p className="text-2xl font-bold">{uniqueAsins}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/10 p-2">
              <Hash className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Quantity</p>
              <p className="text-2xl font-bold">{totalQuantity}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <PoundSterling className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Upload Value</p>
              <p className="text-2xl font-bold">£{totalUploadValue.toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
