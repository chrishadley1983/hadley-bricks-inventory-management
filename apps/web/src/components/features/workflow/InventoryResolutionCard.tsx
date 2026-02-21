'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import type { ResolutionStats } from '@/app/api/inventory/resolution-stats/route';

interface ResolutionStatsResponse {
  data: ResolutionStats;
}

async function fetchResolutionStats(): Promise<ResolutionStats> {
  const response = await fetch('/api/inventory/resolution-stats');
  if (!response.ok) {
    throw new Error('Failed to fetch resolution stats');
  }
  const data: ResolutionStatsResponse = await response.json();
  return data.data;
}

interface InventoryResolutionCardProps {
  className?: string;
}

export function InventoryResolutionCard({ className }: InventoryResolutionCardProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['resolution-stats'],
    queryFn: fetchResolutionStats,
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
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            <Skeleton className="h-8 w-8" />
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
            <span className="text-sm">Failed to load resolution stats</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { pendingReview = 0, unlinkedSince2026 = 0, totalUnlinked = 0 } = data ?? {};
  const hasIssues = pendingReview > 0 || unlinkedSince2026 > 0;

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                hasIssues
                  ? 'bg-amber-100 dark:bg-amber-900/30'
                  : 'bg-green-100 dark:bg-green-900/30'
              }`}
            >
              {hasIssues ? (
                <Link2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              )}
            </div>
            <div>
              <p className="font-medium text-sm">Inventory Resolution</p>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>
                  <span
                    className={
                      pendingReview > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : ''
                    }
                  >
                    {pendingReview} Pending Review
                  </span>
                </p>
                <p>
                  <span
                    className={
                      unlinkedSince2026 > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''
                    }
                  >
                    {unlinkedSince2026} Unlinked since Jan 2026
                  </span>
                </p>
                <p>{totalUnlinked.toLocaleString()} Total Unlinked</p>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/inventory-resolution">
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
