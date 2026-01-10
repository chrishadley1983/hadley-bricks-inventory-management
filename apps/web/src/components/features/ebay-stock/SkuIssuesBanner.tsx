'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEbaySkuIssues } from '@/hooks/use-ebay-stock';

export function SkuIssuesBanner() {
  const { data, isLoading } = useEbaySkuIssues();

  if (isLoading || !data?.summary?.totalIssueCount) {
    return null;
  }

  const { emptySkuCount, duplicateSkuCount, totalIssueCount } = data.summary;

  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <div>
          <p className="font-medium text-destructive">
            {totalIssueCount} SKU issue{totalIssueCount !== 1 ? 's' : ''} found
          </p>
          <p className="text-sm text-muted-foreground">
            {emptySkuCount > 0 && `${emptySkuCount} empty SKU${emptySkuCount !== 1 ? 's' : ''}`}
            {emptySkuCount > 0 && duplicateSkuCount > 0 && ', '}
            {duplicateSkuCount > 0 &&
              `${duplicateSkuCount} duplicate SKU${duplicateSkuCount !== 1 ? 's' : ''}`}
            . Fix these on eBay for accurate stock comparison.
          </p>
        </div>
      </div>
      <Button variant="destructive" size="sm" asChild>
        <Link href="/ebay-stock/sku-issues">View Issues</Link>
      </Button>
    </div>
  );
}
