'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { RepricingFilters } from './RepricingFilters';
import { RepricingTable } from './RepricingTable';
import { useRepricingData, useSyncPricing } from '@/hooks/use-repricing';
import type { RepricingFilters as FilterType } from '@/lib/repricing';

interface RepricingViewProps {
  platform?: string;
}

export function RepricingView({ platform: _platform = 'amazon' }: RepricingViewProps) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FilterType>({});
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading, error, isFetching } = useRepricingData(filters, page, pageSize);

  const syncPricing = useSyncPricing();

  // Handle filter change
  const handleFiltersChange = useCallback((newFilters: FilterType) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page on filter change
  }, []);

  // Handle sync prices
  const handleSyncPrices = useCallback(async () => {
    try {
      await syncPricing.mutateAsync();
      toast({
        title: 'Prices synced',
        description: 'Fresh pricing data has been fetched from Amazon.',
      });
    } catch (err) {
      toast({
        title: 'Sync failed',
        description: err instanceof Error ? err.message : 'Failed to sync prices',
        variant: 'destructive',
      });
    }
  }, [syncPricing, toast]);

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Repricing</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : 'Failed to load repricing data'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { items, summary, pagination } = data ?? {
    items: [],
    summary: null,
    pagination: null,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Repricing
          {pagination && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({pagination.total} items)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <RepricingFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onSyncPrices={handleSyncPrices}
          isSyncing={syncPricing.isPending || isFetching}
          summary={summary ?? undefined}
        />

        {/* Table */}
        <RepricingTable items={items} isLoading={isLoading} />

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={pagination.page >= pagination.totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
