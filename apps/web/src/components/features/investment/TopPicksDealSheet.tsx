'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { usePredictions, useInvestmentThemes } from '@/hooks/use-investment';
import { getRationaleChips } from './rationale';
import type { PredictionItem } from '@/lib/api/investment';

const PAGE_SIZE = 25;

const RETIRING_WITHIN_OPTIONS = [
  { label: 'Any timeframe', value: undefined },
  { label: 'Retiring within 3 months', value: 3 },
  { label: 'Retiring within 6 months', value: 6 },
  { label: 'Retiring within 12 months', value: 12 },
] as const;

const CONFIDENCE_OPTIONS = [
  { label: 'Any confidence', value: undefined },
  { label: 'High confidence (≥0.49)', value: 0.49 },
  { label: 'Medium+ (≥0.3)', value: 0.3 },
] as const;

function RationaleChips({ item }: { item: PredictionItem }) {
  const chips = getRationaleChips(item);
  if (chips.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-[280px] flex-wrap gap-1">
      {chips.map((chip) => (
        <Badge
          key={chip.label}
          variant="outline"
          className={
            chip.tone === 'positive'
              ? 'border-green-600/40 text-xs text-green-700 dark:text-green-400'
              : 'border-amber-600/40 text-xs text-amber-700 dark:text-amber-400'
          }
        >
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}

export function TopPicksDealSheet() {
  const [page, setPage] = useState(1);
  const [retiringWithin, setRetiringWithin] = useState<number | undefined>(undefined);
  const [minConfidence, setMinConfidence] = useState<number | undefined>(undefined);
  const [theme, setTheme] = useState<string | undefined>(undefined);

  const { data: themes = [] } = useInvestmentThemes();
  const { data, isLoading, error } = usePredictions({
    page,
    pageSize: PAGE_SIZE,
    retiringWithinMonths: retiringWithin,
    minConfidence,
    theme,
  });

  const resetPage = () => setPage(1);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load top picks: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={retiringWithin != null ? String(retiringWithin) : 'all'}
          onValueChange={(value: string) => {
            setRetiringWithin(value === 'all' ? undefined : Number(value));
            resetPage();
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Retiring within" />
          </SelectTrigger>
          <SelectContent>
            {RETIRING_WITHIN_OPTIONS.map((option) => (
              <SelectItem key={option.label} value={option.value != null ? String(option.value) : 'all'}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={minConfidence != null ? String(minConfidence) : 'all'}
          onValueChange={(value: string) => {
            setMinConfidence(value === 'all' ? undefined : Number(value));
            resetPage();
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Confidence" />
          </SelectTrigger>
          <SelectContent>
            {CONFIDENCE_OPTIONS.map((option) => (
              <SelectItem key={option.label} value={option.value != null ? String(option.value) : 'all'}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={theme ?? 'all'}
          onValueChange={(value: string) => {
            setTheme(value === 'all' ? undefined : value);
            resetPage();
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All themes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All themes</SelectItem>
            {themes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Deal sheet */}
      {isLoading ? (
        <div className="h-[600px] animate-pulse rounded-lg border bg-muted" />
      ) : data && data.data.length > 0 ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">RRP</TableHead>
                  <TableHead className="text-right">Max buy</TableHead>
                  <TableHead className="text-right">Expected sale (1yr)</TableHead>
                  <TableHead className="text-right">1yr prediction</TableHead>
                  <TableHead>Retirement</TableHead>
                  <TableHead>Rationale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((item, index) => {
                  const { prediction, max_buy } = item;
                  const rank = (data.page - 1) * data.pageSize + index + 1;
                  return (
                    <TableRow key={prediction.set_num}>
                      <TableCell className="font-mono text-muted-foreground">{rank}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.set_name ?? prediction.set_num}
                              className="h-10 w-10 rounded object-contain"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded bg-muted" />
                          )}
                          <div className="min-w-0">
                            <Link
                              href={`/investment/${encodeURIComponent(prediction.set_num)}`}
                              className="block max-w-[200px] truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {item.set_name ?? prediction.set_num}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              #{prediction.set_num}
                              {item.theme ? ` · ${item.theme}` : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            prediction.investment_score >= 7
                              ? 'default'
                              : prediction.investment_score >= 4
                                ? 'secondary'
                                : 'destructive'
                          }
                          className="font-mono tabular-nums"
                        >
                          {prediction.investment_score.toFixed(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.uk_retail_price != null
                          ? formatCurrency(item.uk_retail_price)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {max_buy ? (
                          <div>
                            <div className="font-semibold tabular-nums">
                              {formatCurrency(max_buy.recommendedMaxBuy)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {max_buy.recommendedPctOfRrp.toFixed(0)}% of RRP · amber{' '}
                              {formatCurrency(max_buy.amberMaxBuy)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {max_buy ? formatCurrency(max_buy.expectedSale) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {prediction.predicted_1yr_appreciation != null ? (
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
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.retirement_status === 'retiring_soon' ? (
                          <Badge variant="destructive">Retiring soon</Badge>
                        ) : item.expected_retirement_date ? (
                          <span className="text-sm">{formatDate(item.expected_retirement_date)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RationaleChips item={item} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">
            No scored sets match these filters. Run the scoring pipeline or loosen the filters.
          </p>
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {data.total} scored sets · page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
