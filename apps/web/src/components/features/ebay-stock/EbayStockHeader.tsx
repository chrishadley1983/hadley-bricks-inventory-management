'use client';

import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ListingImport } from '@/lib/platform-stock/types';

interface EbayStockHeaderProps {
  latestImport: ListingImport | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function EbayStockHeader({ latestImport, onRefresh, isRefreshing }: EbayStockHeaderProps) {
  const lastImportTime = latestImport?.completedAt
    ? formatDistanceToNow(new Date(latestImport.completedAt), { addSuffix: true })
    : null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold">eBay Stock</h1>
        <p className="text-muted-foreground">
          Compare your eBay listings with inventory to find discrepancies.
        </p>
        {lastImportTime && (
          <p className="text-sm text-muted-foreground mt-1">
            Last imported: {lastImportTime}
            {latestImport?.totalRows !== null && <span> ({latestImport?.totalRows} listings)</span>}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Importing...' : 'Import from eBay'}
        </Button>
      </div>
    </div>
  );
}
