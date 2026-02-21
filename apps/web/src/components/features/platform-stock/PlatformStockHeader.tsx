'use client';

import { Button } from '@/components/ui/button';
import { RefreshCw, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ListingImport } from '@/lib/platform-stock';
import { LastImportInfo } from './ImportStatusBanner';

interface PlatformStockHeaderProps {
  platform: string;
  latestImport?: ListingImport | null;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onExport?: () => void;
  className?: string;
}

export function PlatformStockHeader({
  platform,
  latestImport,
  onRefresh,
  isRefreshing = false,
  onExport,
  className,
}: PlatformStockHeaderProps) {
  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{platformLabel} Stock</h1>
        <p className="text-muted-foreground">
          Compare {platformLabel} listings against your inventory
        </p>
        <LastImportInfo import={latestImport} className="mt-1" />
      </div>

      <div className="flex items-center gap-2">
        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        )}
        <Button onClick={onRefresh} disabled={isRefreshing} size="sm">
          <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
          {isRefreshing ? 'Importing...' : `Refresh from ${platformLabel}`}
        </Button>
      </div>
    </div>
  );
}
