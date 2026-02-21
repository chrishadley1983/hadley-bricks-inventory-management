/**
 * Comparison Summary Component
 * F39-F42: Delta table comparing two scenarios
 */

'use client';

import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ComparisonDelta } from '@/types/cost-modelling';
import { formatCurrency } from '@/lib/services/cost-calculations';
import { cn } from '@/lib/utils';

interface ComparisonSummaryProps {
  deltas: ComparisonDelta[];
}

export function ComparisonSummary({ deltas }: ComparisonSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparison Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          {/* F39: Table with columns: Metric, Scenario A, Scenario B, Delta, % Change */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Scenario A</TableHead>
                <TableHead className="text-right">Scenario B</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead className="text-right">% Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* F40: 5 rows for key metrics */}
              {deltas.map((row) => (
                <TableRow
                  key={row.metric}
                  className={cn(
                    // F42: Highlight rows with >10% change
                    row.isHighlighted && 'bg-amber-50 dark:bg-amber-950/20'
                  )}
                >
                  <TableCell className="font-medium">{row.metric}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.scenarioAValue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.scenarioBValue)}</TableCell>
                  <TableCell className="text-right">
                    {/* F41: Delta = (Scenario B - Scenario A) */}
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        row.isBetter ? 'text-green-600' : row.delta === 0 ? '' : 'text-red-600'
                      )}
                    >
                      {row.delta > 0 ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : row.delta < 0 ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <Minus className="h-3 w-3 text-muted-foreground" />
                      )}
                      {formatCurrency(Math.abs(row.delta))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {/* F41: % Change = ((B-A)/A × 100) */}
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        row.isBetter
                          ? 'text-green-600'
                          : row.percentChange === 0
                            ? ''
                            : 'text-red-600'
                      )}
                    >
                      {row.percentChange > 0 ? '+' : ''}
                      {row.percentChange.toFixed(1)}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ArrowUp className="h-3 w-3 text-green-600" />
            <span>B is higher</span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowDown className="h-3 w-3 text-red-600" />
            <span>B is lower</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-amber-100 dark:bg-amber-950 rounded" />
            <span>Change &gt;10%</span>
          </div>
          <div className="flex items-center gap-1 text-green-600">Green = B is better</div>
        </div>
      </CardContent>
    </Card>
  );
}
