'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { usePredictions } from '@/hooks/use-investment';
import type { PredictionItem } from '@/lib/api/investment';

function PickCard({ item, rank }: { item: PredictionItem; rank: number }) {
  const { prediction, max_buy } = item;

  return (
    <Link href={`/investment/${encodeURIComponent(prediction.set_num)}`}>
      <Card className="h-full cursor-pointer transition-colors hover:border-primary">
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-start justify-between">
            <span className="text-2xl font-bold text-muted-foreground/50">#{rank}</span>
            <div className="flex items-center gap-1.5">
              {max_buy?.tier === 'HIGH' && (
                <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400">
                  HIGH
                </Badge>
              )}
              <Badge
                variant={
                  prediction.investment_score >= 7
                    ? 'default'
                    : prediction.investment_score >= 4
                      ? 'secondary'
                      : 'destructive'
                }
                className="px-2 font-mono text-lg"
              >
                {prediction.investment_score.toFixed(1)}
              </Badge>
            </div>
          </div>

          <div className="flex gap-3">
            {item.image_url ? (
              <img
                src={item.image_url}
                alt={item.set_name ?? prediction.set_num}
                className="h-12 w-12 rounded object-contain"
                loading="lazy"
              />
            ) : (
              <div className="h-12 w-12 rounded bg-muted" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {item.set_name ?? prediction.set_num}
              </div>
              <div className="text-xs text-muted-foreground">
                #{prediction.set_num}
                {item.theme ? ` · ${item.theme}` : ''}
              </div>
            </div>
          </div>

          <div className="space-y-1 text-sm">
            {max_buy && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max buy</span>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(max_buy.recommendedMaxBuy)}
                </span>
              </div>
            )}
            {prediction.predicted_1yr_appreciation != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">1yr prediction</span>
                <span
                  className={
                    prediction.predicted_1yr_appreciation >= 0
                      ? 'font-medium text-green-600 dark:text-green-400'
                      : 'font-medium text-red-600 dark:text-red-400'
                  }
                >
                  {prediction.predicted_1yr_appreciation > 0 ? '+' : ''}
                  {prediction.predicted_1yr_appreciation.toFixed(1)}%
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">RRP</span>
              <span className="tabular-nums">
                {item.uk_retail_price != null ? formatCurrency(item.uk_retail_price) : '—'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function TopPicksPreview() {
  const { data, isLoading, error } = usePredictions({ pageSize: 8 });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-48 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load top picks{error ? `: ${error.message}` : ''}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Top picks</h3>
          <p className="text-sm text-muted-foreground">
            Highest-scored sets with a recommended max buy price
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/investment/top-picks">
            Full deal sheet
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
      {data.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {data.data.map((item, index) => (
            <PickCard key={item.prediction.set_num} item={item} rank={index + 1} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No scored sets found. Run the scoring pipeline first.
        </div>
      )}
    </div>
  );
}
