'use client';

/**
 * Profit Summary Cards Component
 * F22: Four hero metrics - Annual Profit, Take-Home, Weekly Take-Home, Profit vs Target
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Target, Wallet, Calendar, Coins } from 'lucide-react';
import { formatCurrency } from '@/lib/services/cost-calculations';
import type { CalculatedResults } from '@/types/cost-modelling';
import { cn } from '@/lib/utils';

interface ProfitSummaryCardsProps {
  calculations: CalculatedResults;
  targetProfit: number;
  /** For compare mode - show delta indicators */
  compareCalculations?: CalculatedResults;
  /** Comparison deltas for F43 indicators */
  comparisonDeltas?: import('@/types/cost-modelling').ComparisonDelta[] | null;
  /** Scenario label (A or B) for compare mode */
  scenarioLabel?: 'A' | 'B';
}

export function ProfitSummaryCards({
  calculations,
  targetProfit,
  compareCalculations,
  comparisonDeltas: _comparisonDeltas,
  scenarioLabel: _scenarioLabel,
}: ProfitSummaryCardsProps) {
  const {
    netProfit,
    takeHome,
    weeklyTakeHome,
    profitVsTarget,
  } = calculations;

  const isOnTarget = profitVsTarget >= 0;

  // Calculate deltas for compare mode
  const deltaProfit = compareCalculations
    ? compareCalculations.netProfit - netProfit
    : null;
  const deltaTakeHome = compareCalculations
    ? compareCalculations.takeHome - takeHome
    : null;
  const deltaWeekly = compareCalculations
    ? compareCalculations.weeklyTakeHome - weeklyTakeHome
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Annual Profit */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Annual Profit</CardTitle>
          <Coins className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(netProfit)}</div>
          {/* F43: Delta indicator */}
          {deltaProfit !== null && (
            <DeltaIndicator value={deltaProfit} higherIsBetter />
          )}
          <p className="text-xs text-muted-foreground">After all costs</p>
        </CardContent>
      </Card>

      {/* Take-Home */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Take-Home</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(takeHome)}</div>
          {deltaTakeHome !== null && (
            <DeltaIndicator value={deltaTakeHome} higherIsBetter />
          )}
          <p className="text-xs text-muted-foreground">After tax</p>
        </CardContent>
      </Card>

      {/* Weekly Take-Home */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Weekly Take-Home</CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(weeklyTakeHome)}</div>
          {deltaWeekly !== null && (
            <DeltaIndicator value={deltaWeekly} higherIsBetter />
          )}
          <p className="text-xs text-muted-foreground">Per week average</p>
        </CardContent>
      </Card>

      {/* Profit vs Target */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">vs Target</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {/* U7: Positive/negative colouring */}
          <div
            className={cn(
              'text-2xl font-bold',
              isOnTarget ? 'text-green-600' : 'text-red-600'
            )}
          >
            {profitVsTarget >= 0 ? '+' : ''}
            {formatCurrency(profitVsTarget)}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {isOnTarget ? (
              <TrendingUp className="h-3 w-3 text-green-600" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-600" />
            )}
            Target: {formatCurrency(targetProfit)}
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
  value,
  higherIsBetter = true,
}: {
  value: number;
  higherIsBetter?: boolean;
}) {
  const isPositive = value > 0;
  const isBetter = higherIsBetter ? isPositive : !isPositive;

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
      {formatCurrency(value)}
    </div>
  );
}
