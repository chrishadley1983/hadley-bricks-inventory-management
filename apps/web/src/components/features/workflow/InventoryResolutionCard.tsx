'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

interface ResolutionQueueResponse {
  data: unknown[];
  pagination: {
    total: number;
  };
}

async function fetchResolutionCount(): Promise<{ total: number }> {
  // Fetch from eBay resolution queue (primary)
  const ebayResponse = await fetch('/api/ebay/resolution-queue?pageSize=1');
  let ebayTotal = 0;
  if (ebayResponse.ok) {
    const ebayData: ResolutionQueueResponse = await ebayResponse.json();
    ebayTotal = ebayData.pagination?.total ?? 0;
  }

  // Fetch from Amazon resolution queue
  const amazonResponse = await fetch('/api/amazon/resolution-queue?pageSize=1');
  let amazonTotal = 0;
  if (amazonResponse.ok) {
    const amazonData: ResolutionQueueResponse = await amazonResponse.json();
    amazonTotal = amazonData.pagination?.total ?? 0;
  }

  return { total: ebayTotal + amazonTotal };
}

interface InventoryResolutionCardProps {
  className?: string;
}

export function InventoryResolutionCard({ className }: InventoryResolutionCardProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['resolution-queue-count'],
    queryFn: fetchResolutionCount,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24 mt-1" />
              </div>
            </div>
            <Skeleton className="h-8 w-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">Failed to load resolution count</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = data?.total ?? 0;
  const hasPending = total > 0;

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                hasPending ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-green-100 dark:bg-green-900/30'
              }`}
            >
              {hasPending ? (
                <Link2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              )}
            </div>
            <div>
              <p className="font-medium text-sm">Inventory Resolution</p>
              <p className="text-xs text-muted-foreground">
                {hasPending ? `${total} items need matching` : 'All items matched'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasPending && (
              <Badge variant="secondary">{total}</Badge>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/settings/inventory-resolution">
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
