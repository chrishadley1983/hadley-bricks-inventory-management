'use client';

/**
 * Profit Summary Cards Component
 * F22: Five hero metrics - Revenue, Annual Profit, Take-Home, Weekly Take-Home, Profit vs Target
 * F43: Delta indicators in compare mode
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Target, Wallet, Calendar, Coins, PoundSterling } from 'lucide-react';
import { formatCurrency } from '@/lib/services/cost-calculations';
import type { CalculatedResults, ComparisonDelta } from '@/types/cost-modelling';
import { cn } from '@/lib/utils';

interface ProfitSummaryCardsProps {
  calculations: CalculatedResults;
  targetProfit: number;
  /** Comparison deltas for F43 indicators */
  comparisonDeltas?: ComparisonDelta[] | null;
  /** Scenario label (A or B) for compare mode */
  scenarioLabel?: 'A' | 'B';
}

/**
 * Get delta for a specific metric from the comparison deltas array
 */
function getDeltaForMetric(
  deltas: ComparisonDelta[] | null | undefined,
  metricName: string
): ComparisonDelta | undefined {
  if (!deltas) return undefined;
  return deltas.find((d) => d.metric === metricName);
}

export function ProfitSummaryCards({
  calculations,
  targetProfit,
  comparisonDeltas,
  scenarioLabel,
}: ProfitSummaryCardsProps) {
  const {
    totalTurnover,
    netProfit,
    takeHome,
    weeklyTakeHome,
    profitVsTarget,
  } = calculations;

  const isOnTarget = profitVsTarget >= 0;

  // F43: Only show deltas on Scenario B (A is the baseline)
  const showDeltas = scenarioLabel === 'B' && comparisonDeltas && comparisonDeltas.length > 0;
  // In compare mode, Scenario A needs a spacer to align with Scenario B's delta row
  const isCompareMode = scenarioLabel === 'A' || scenarioLabel === 'B';
  const needsSpacer = isCompareMode && scenarioLabel === 'A';

  // Get deltas from the comparison array
  const revenueDelta = showDeltas ? getDeltaForMetric(comparisonDeltas, 'Annual Turnover') : undefined;
  const profitDelta = showDeltas ? getDeltaForMetric(comparisonDeltas, 'Net Profit') : undefined;
  const takeHomeDelta = showDeltas ? getDeltaForMetric(comparisonDeltas, 'Take-Home') : undefined;
  // Weekly delta is calculated from take-home delta
  const weeklyDeltaValue = takeHomeDelta ? takeHomeDelta.delta / 52 : undefined;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {/* Revenue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
          <CardTitle className="text-xs font-medium">Revenue</CardTitle>
          <PoundSterling className="h-3.5 w-3.5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="text-lg font-bold">{formatCurrency(totalTurnover)}</div>
          {/* F43: Delta indicator for Scenario B, or spacer for Scenario A alignment */}
          {revenueDelta ? (
            <DeltaIndicator delta={revenueDelta} higherIsBetter />
          ) : needsSpacer ? (
            <div className="h-4" aria-hidden="true" />
          ) : null}
          <p className="text-[10px] text-muted-foreground">Total turnover</p>
        </CardContent>
      </Card>

      {/* Annual Profit */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
          <CardTitle className="text-xs font-medium">Profit</CardTitle>
          <Coins className="h-3.5 w-3.5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="text-lg font-bold">{formatCurrency(netProfit)}</div>
          {/* F43: Delta indicator for Scenario B, or spacer for Scenario A alignment */}
          {profitDelta ? (
            <DeltaIndicator delta={profitDelta} higherIsBetter />
          ) : needsSpacer ? (
            <div className="h-4" aria-hidden="true" />
          ) : null}
          <p className="text-[10px] text-muted-foreground">After all costs</p>
        </CardContent>
      </Card>

      {/* Take-Home */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
          <CardTitle className="text-xs font-medium">Take-Home</CardTitle>
          <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="text-lg font-bold">{formatCurrency(takeHome)}</div>
          {/* F43: Delta indicator for Scenario B, or spacer for Scenario A alignment */}
          {takeHomeDelta ? (
            <DeltaIndicator delta={takeHomeDelta} higherIsBetter />
          ) : needsSpacer ? (
            <div className="h-4" aria-hidden="true" />
          ) : null}
          <p className="text-[10px] text-muted-foreground">After tax</p>
        </CardContent>
      </Card>

      {/* Weekly Take-Home */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
          <CardTitle className="text-xs font-medium">Weekly</CardTitle>
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="text-lg font-bold">{formatCurrency(weeklyTakeHome)}</div>
          {/* F43: Delta indicator for Scenario B (weekly is take-home / 52), or spacer */}
          {weeklyDeltaValue !== undefined && takeHomeDelta ? (
            <DeltaIndicator
              delta={{ ...takeHomeDelta, delta: weeklyDeltaValue }}
              higherIsBetter
            />
          ) : needsSpacer ? (
            <div className="h-4" aria-hidden="true" />
          ) : null}
          <p className="text-[10px] text-muted-foreground">Per week avg</p>
        </CardContent>
      </Card>

      {/* Profit vs Target */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
          <CardTitle className="text-xs font-medium">vs Target</CardTitle>
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {/* U7: Positive/negative colouring */}
          <div
            className={cn(
              'text-lg font-bold',
              isOnTarget ? 'text-green-600' : 'text-red-600'
            )}
          >
            {profitVsTarget >= 0 ? '+' : ''}
            {formatCurrency(profitVsTarget)}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {isOnTarget ? (
              <TrendingUp className="h-2.5 w-2.5 text-green-600" />
            ) : (
              <TrendingDown className="h-2.5 w-2.5 text-red-600" />
            )}
            {formatCurrency(targetProfit)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Delta indicator for compare mode
 * F43: Green up arrow if B better, red down arrow if worse
 */
function DeltaIndicator({
  delta,
  higherIsBetter = true,
}: {
  delta: ComparisonDelta | { delta: number; isBetter?: boolean };
  higherIsBetter?: boolean;
}) {
  const value = delta.delta;
  const isPositive = value > 0;

  // Use isBetter from delta if available, otherwise calculate based on higherIsBetter
  const isBetter = 'isBetter' in delta && delta.isBetter !== undefined
    ? delta.isBetter
    : (higherIsBetter ? isPositive : !isPositive);

  // Don't show indicator for zero delta
  if (value === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs',
        isBetter ? 'text-green-600' : 'text-red-600'
      )}
    >
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {value >= 0 ? '+' : ''}
      {formatCurrency(Math.abs(value))}
    </div>
  );
}
