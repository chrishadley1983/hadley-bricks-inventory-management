'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency, formatDate } from '@/lib/utils';
import { fetchPredictions } from '@/lib/api/investment';
import type { InvestmentPrediction } from '@/lib/api/investment';

const RETIRING_WITHIN_OPTIONS = [
  { label: 'All', value: undefined },
  { label: '3 months', value: 3 },
  { label: '6 months', value: 6 },
  { label: '12 months', value: 12 },
] as const;

export function TopPicks() {
  const [retiringWithin, setRetiringWithin] = useState<number | undefined>(undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ['investment-predictions', 'top-picks', retiringWithin],
    queryFn: () => fetchPredictions({
      pageSize: 20,
      retiringWithinMonths: retiringWithin,
    }),
  });

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load top picks: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground mr-1">Retiring within:</span>
        {RETIRING_WITHIN_OPTIONS.map((option) => (
          <Button
            key={option.label}
            variant={retiringWithin === option.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRetiringWithin(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      ) : data?.data && data.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {data.data.map((item, index) => {
            const prediction = item.prediction as InvestmentPrediction;
            const set = item as unknown as Record<string, unknown>;

            return (
              <Link
                key={prediction.set_num}
                href={`/investment/${encodeURIComponent(prediction.set_num)}`}
              >
                <Card className="h-full hover:border-primary transition-colors cursor-pointer">
                  <CardContent className="pt-4 space-y-3">
                    {/* Rank + Score */}
                    <div className="flex items-start justify-between">
                      <span className="text-2xl font-bold text-muted-foreground/50">
                        #{index + 1}
                      </span>
                      <Badge
                        variant={
                          prediction.investment_score >= 7
                            ? 'default'
                            : prediction.investment_score >= 4
                              ? 'secondary'
                              : 'destructive'
                        }
                        className="text-lg font-mono px-2"
                      >
                        {prediction.investment_score.toFixed(1)}
                      </Badge>
                    </div>

                    {/* Image + Name */}
                    <div className="flex gap-3">
                      {(set.image_url as string) ? (
                        <img
                          src={set.image_url as string}
                          alt={set.set_name as string}
                          className="h-12 w-12 rounded object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded bg-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {(set.set_name as string) || prediction.set_num}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          #{prediction.set_num}
                        </div>
                      </div>
                    </div>

                    {/* Key Metrics */}
                    <div className="space-y-1 text-sm">
                      {prediction.predicted_1yr_appreciation != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">1yr prediction</span>
                          <span className={prediction.predicted_1yr_appreciation >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {prediction.predicted_1yr_appreciation > 0 ? '+' : ''}
                            {prediction.predicted_1yr_appreciation.toFixed(1)}%
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between">
                        <span className="text-muted-foreground">RRP</span>
                        <span>{(set.uk_retail_price as number | null) != null ? formatCurrency(set.uk_retail_price as number) : '\u2014'}</span>
                      </div>

                      {(set.retirement_status as string) && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <Badge
                            variant={
                              (set.retirement_status as string) === 'retiring_soon'
                                ? 'destructive'
                                : 'outline'
                            }
                            className="text-xs"
                          >
                            {(set.retirement_status as string) === 'retiring_soon' ? 'Retiring Soon' : (set.retirement_status as string)}
                          </Badge>
                        </div>
                      )}

                      {(set.expected_retirement_date as string) && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Retirement</span>
                          <span className="text-xs">{formatDate(set.expected_retirement_date as string)}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">
            No scored sets found{retiringWithin ? ` retiring within ${retiringWithin} months` : ''}.
            Run the scoring pipeline first.
          </p>
        </div>
      )}

      {/* Total count */}
      {data?.total != null && data.total > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          Showing top {data.data.length} of {data.total} scored sets
        </p>
      )}
    </div>
  );
}
