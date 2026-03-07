'use client';

import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { Scale, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TableSkeleton, StatCardSkeleton } from '@/components/ui/skeletons';
import type { BuyBoxGapRow } from '@/app/api/reports/buy-box-gap/route';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const BuyBoxGapTable = dynamic(
  () =>
    import('@/components/features/buy-box-gap').then((mod) => ({
      default: mod.BuyBoxGapTable,
    })),
  { ssr: false, loading: () => <TableSkeleton columns={12} rows={10} /> }
);

interface BuyBoxGapResponse {
  data: {
    items: BuyBoxGapRow[];
    summary: {
      totalInStock: number;
      losingBuyBox: number;
      winningBuyBox: number;
      matchBB: number;
      review: number;
      loss: number;
      noCost: number;
      avgGap: number;
      totalGapValue: number;
    };
  };
}

async function fetchBuyBoxGap(): Promise<BuyBoxGapResponse> {
  const res = await fetch('/api/reports/buy-box-gap');
  if (!res.ok) throw new Error('Failed to fetch buy box gap data');
  return res.json();
}

function formatGBP(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
}

export default function BuyBoxGapPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['buy-box-gap'],
    queryFn: fetchBuyBoxGap,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const summary = data?.data.summary;
  const items = data?.data.items ?? [];

  return (
    <>
      <Header />
      <div className="p-6 space-y-6">
        {/* Page Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Scale className="h-6 w-6 text-orange-500" />
              Buy Box Gap
            </h1>
            <p className="text-muted-foreground">
              In-stock listings not winning the buy box. Reprice to match or beat competitors.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-6">
          {isLoading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : summary ? (
            <>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium">Losing Buy Box</p>
                  <p className="text-2xl font-bold text-slate-800">{summary.losingBuyBox}</p>
                  <p className="text-xs text-muted-foreground">of {summary.totalInStock} in-stock</p>
                </CardContent>
              </Card>
              <Card className="border-t-2 border-t-green-500">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium">Match Buy Box</p>
                  <p className="text-2xl font-bold text-green-600">{summary.matchBB}</p>
                  <p className="text-xs text-muted-foreground">margin &ge; 15%</p>
                </CardContent>
              </Card>
              <Card className="border-t-2 border-t-amber-500">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium">Review</p>
                  <p className="text-2xl font-bold text-amber-600">{summary.review}</p>
                  <p className="text-xs text-muted-foreground">margin 5-15%</p>
                </CardContent>
              </Card>
              <Card className="border-t-2 border-t-red-500">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium">Loss / Marginal</p>
                  <p className="text-2xl font-bold text-red-600">{summary.loss}</p>
                  <p className="text-xs text-muted-foreground">margin &lt; 5%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium">Avg Gap</p>
                  <p className="text-2xl font-bold text-slate-800">{formatGBP(summary.avgGap)}</p>
                  <p className="text-xs text-muted-foreground">your price vs BB</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium">Total Gap Value</p>
                  <p className="text-2xl font-bold text-slate-800">{formatGBP(summary.totalGapValue)}</p>
                  <p className="text-xs text-muted-foreground">gap x qty</p>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        {/* Data freshness notice */}
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          <strong>Data freshness:</strong> Buy box prices from last SP-API/Keepa sync. Your price and stock from daily SP-API sync. Run the CLI script for live buy box data.
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Buy Box Gap — In-Stock Listings</CardTitle>
            <CardDescription>
              Click &quot;Reprice&quot; to update the price and push to the Amazon sync queue. Suggested price rounds down to the nearest .49/.99 below the buy box.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BuyBoxGapTable
              items={items}
              isLoading={isLoading}
              onRepriceSuccess={() => refetch()}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
