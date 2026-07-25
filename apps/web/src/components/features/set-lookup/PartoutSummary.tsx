'use client';

import { Package, Database, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { PartoutData } from '@/types/partout';

/**
 * Calculate missing pricing statistics from parts data
 */
function getMissingPriceStats(data: PartoutData) {
  const missingNew = data.parts.filter((p) => p.priceNew === null).length;
  const missingUsed = data.parts.filter((p) => p.priceUsed === null).length;
  const total = data.parts.length;
  return { missingNew, missingUsed, total };
}

interface PartoutSummaryProps {
  data: PartoutData;
}

/**
 * Format a ratio with 2 decimal places and 'x' suffix
 */
function formatRatio(ratio: number | null): string {
  if (ratio === null) return 'N/A';
  return `${ratio.toFixed(2)}x`;
}

/**
 * Get ratio color class based on value
 */
function getRatioColorClass(ratio: number | null): string {
  if (ratio === null) return 'text-muted-foreground';
  return ratio > 1 ? 'text-green-600' : 'text-red-600';
}

/**
 * PartoutSummary Component
 *
 * Displays summary cards with POV totals, ratios, and recommendation
 */
export function PartoutSummary({ data }: PartoutSummaryProps) {
  const missingStats = getMissingPriceStats(data);
  const hasMissingPrices = missingStats.missingNew > 0 || missingStats.missingUsed > 0;

  return (
    <div className="space-y-4">
      {/* POV Totals and Ratios */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* New POV Total */}
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-muted-foreground">POV (New)</div>
            <div className="text-2xl font-bold" data-testid="pov-new-total">
              {formatCurrency(data.povNew)}
            </div>
            {data.setPrice.new !== null && (
              <div className="text-xs text-muted-foreground">
                Set: {formatCurrency(data.setPrice.new)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* New Ratio */}
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-muted-foreground">Ratio (New)</div>
            <div
              className={`text-2xl font-bold ${getRatioColorClass(data.ratioNew)}`}
              data-testid="pov-new-ratio"
            >
              {formatRatio(data.ratioNew)}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.ratioNew !== null ? 'Gross, before fees' : 'No set price'}
            </div>
          </CardContent>
        </Card>

        {/* Used POV Total */}
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-muted-foreground">POV (Used)</div>
            <div className="text-2xl font-bold" data-testid="pov-used-total">
              {formatCurrency(data.povUsed)}
            </div>
            {data.setPrice.used !== null && (
              <div className="text-xs text-muted-foreground">
                Set: {formatCurrency(data.setPrice.used)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Used Ratio */}
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm font-medium text-muted-foreground">Ratio (Used)</div>
            <div
              className={`text-2xl font-bold ${getRatioColorClass(data.ratioUsed)}`}
              data-testid="pov-used-ratio"
            >
              {formatRatio(data.ratioUsed)}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.ratioUsed !== null ? 'Gross, before fees' : 'No set price'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
        The recommendation card that used to live here rendered the legacy
        `ratio > 1` test on GROSS value — no fees, no liquidity haircut. It is
        superseded by PartoutAssessmentPanel's canonical verdict, and showing both
        put two contradictory verdicts on one screen.
      */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cache Status */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="flex gap-2">
                <Package className="h-5 w-5 text-muted-foreground" />
                <Database className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Parts Data</div>
                <div className="text-lg font-bold" data-testid="cache-summary">
                  {data.cacheStats.fromCache}/{data.cacheStats.total} parts from cache
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.cacheStats.fromApi > 0
                    ? `${data.cacheStats.fromApi} fetched from BrickLink`
                    : 'All from cache (fast)'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Missing Prices */}
        <Card className={hasMissingPrices ? 'border-amber-200 bg-amber-50' : ''}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className={`h-5 w-5 ${hasMissingPrices ? 'text-amber-600' : 'text-muted-foreground'}`}
              />
              <div>
                <div className="text-sm font-medium text-muted-foreground">Missing Prices</div>
                <div
                  className={`text-lg font-bold ${hasMissingPrices ? 'text-amber-700' : 'text-green-600'}`}
                  data-testid="missing-prices"
                >
                  {hasMissingPrices ? (
                    <>
                      {missingStats.missingNew} New / {missingStats.missingUsed} Used
                    </>
                  ) : (
                    'All priced'
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {hasMissingPrices
                    ? `of ${missingStats.total} total parts`
                    : 'Complete pricing data'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
