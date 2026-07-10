'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CalendarClock, Archive } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useRetirementRadar } from '@/hooks/use-investment';
import { monthsFromNow } from './rationale';
import type { RadarSet } from '@/lib/api/investment';

const CONFIDENCE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  confirmed: 'default',
  likely: 'secondary',
  speculative: 'outline',
};

function SetCell({ row }: { row: RadarSet }) {
  return (
    <div className="flex items-center gap-3">
      {row.image_url ? (
        <img
          src={row.image_url}
          alt={row.set_name ?? row.set_number}
          className="h-10 w-10 rounded object-contain"
          loading="lazy"
        />
      ) : (
        <div className="h-10 w-10 rounded bg-muted" />
      )}
      <div className="min-w-0">
        <Link
          href={`/investment/${encodeURIComponent(row.set_number)}`}
          className="block max-w-[220px] truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.set_name ?? row.set_number}
        </Link>
        <div className="text-xs text-muted-foreground">
          #{row.set_number}
          {row.theme ? ` · ${row.theme}` : ''}
        </div>
      </div>
    </div>
  );
}

function ScoreCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const variant = score >= 7 ? 'default' : score >= 4 ? 'secondary' : 'destructive';
  return (
    <Badge variant={variant} className="font-mono tabular-nums">
      {score.toFixed(1)}
    </Badge>
  );
}

function RetiringTable({ rows }: { rows: RadarSet[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Set</TableHead>
          <TableHead>Expected retirement</TableHead>
          <TableHead>Confidence</TableHead>
          <TableHead className="text-right">RRP</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="text-right">1yr prediction</TableHead>
          <TableHead className="text-right">Max buy</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const months = row.expected_retirement_date
            ? monthsFromNow(row.expected_retirement_date)
            : null;
          return (
            <TableRow key={row.set_number}>
              <TableCell>
                <SetCell row={row} />
              </TableCell>
              <TableCell>
                <div className="text-sm">{formatDate(row.expected_retirement_date)}</div>
                {months != null && (
                  <div
                    className={`text-xs ${months <= 3 ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                  >
                    {months <= 0 ? 'imminent' : `in ${months} mo`}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {row.retirement_confidence ? (
                  <Badge
                    variant={CONFIDENCE_VARIANTS[row.retirement_confidence] ?? 'outline'}
                    className="capitalize"
                  >
                    {row.retirement_confidence}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.uk_retail_price != null ? formatCurrency(row.uk_retail_price) : '—'}
              </TableCell>
              <TableCell className="text-right">
                <ScoreCell score={row.investment_score} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.predicted_1yr_appreciation != null ? (
                  <span
                    className={
                      row.predicted_1yr_appreciation >= 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }
                  >
                    {row.predicted_1yr_appreciation > 0 ? '+' : ''}
                    {row.predicted_1yr_appreciation.toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {row.max_buy ? (
                  <div>
                    <div className="font-medium tabular-nums">
                      {formatCurrency(row.max_buy.recommendedMaxBuy)}
                    </div>
                    {row.max_buy.tier === 'HIGH' && (
                      <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400">
                        HIGH
                      </Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function RetiredTable({ rows }: { rows: RadarSet[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Set</TableHead>
          <TableHead>Retired</TableHead>
          <TableHead className="text-right">RRP</TableHead>
          <TableHead className="text-right">Buy box now</TableHead>
          <TableHead className="text-right">vs RRP</TableHead>
          <TableHead className="text-right">Score</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.set_number}>
            <TableCell>
              <SetCell row={row} />
            </TableCell>
            <TableCell>
              <div className="text-sm">{formatDate(row.retirement_date)}</div>
              {row.retirement_date && (
                <div className="text-xs text-muted-foreground">
                  {Math.abs(monthsFromNow(row.retirement_date))} mo ago
                  {!row.exit_date && ' (estimated)'}
                </div>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.uk_retail_price != null ? formatCurrency(row.uk_retail_price) : '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.buy_box_price != null ? formatCurrency(row.buy_box_price) : '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.buy_box_vs_rrp_pct != null ? (
                <span
                  className={
                    row.buy_box_vs_rrp_pct >= 0
                      ? 'font-medium text-green-600 dark:text-green-400'
                      : 'font-medium text-red-600 dark:text-red-400'
                  }
                >
                  {row.buy_box_vs_rrp_pct > 0 ? '+' : ''}
                  {row.buy_box_vs_rrp_pct.toFixed(0)}%
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <ScoreCell score={row.investment_score} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RetirementRadarSection() {
  const { data, isLoading, error } = useRetirementRadar({ window: 12, limit: 25 });

  if (isLoading) {
    return <div className="h-96 animate-pulse rounded-lg border bg-muted" />;
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-destructive">
          Failed to load retirement radar{error ? `: ${error.message}` : ''}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Retirement radar</CardTitle>
        <CardDescription>
          {data.retiring.total} sets expected to retire in the next 12 months ·{' '}
          {data.retired.total} retired in the last 12 months
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="retiring">
          <TabsList>
            <TabsTrigger value="retiring" className="gap-1.5">
              <CalendarClock className="h-4 w-4" />
              About to retire ({data.retiring.total})
            </TabsTrigger>
            <TabsTrigger value="retired" className="gap-1.5">
              <Archive className="h-4 w-4" />
              Recently retired ({data.retired.total})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="retiring" className="overflow-x-auto">
            {data.retiring.data.length > 0 ? (
              <>
                <RetiringTable rows={data.retiring.data} />
                {data.retiring.total > data.retiring.data.length && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Showing the next {data.retiring.data.length} by date —{' '}
                    <Link href="/investment/sets?retiringWithinMonths=12" className="text-primary hover:underline">
                      browse all {data.retiring.total}
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sets with expected retirement dates in the next 12 months.
              </p>
            )}
          </TabsContent>
          <TabsContent value="retired" className="overflow-x-auto">
            {data.retired.data.length > 0 ? (
              <>
                <RetiredTable rows={data.retired.data} />
                {data.retired.total > data.retired.data.length && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Showing the most recent {data.retired.data.length} —{' '}
                    <Link href="/investment/sets?retirementStatus=retired" className="text-primary hover:underline">
                      browse all retired sets
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sets recorded as retired in the last 12 months.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
