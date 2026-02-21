'use client';

import { TrendingUp, TrendingDown, Package, Database, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
 * Format a number as GBP currency
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
  const isPartOut = data.recommendation === 'part-out';
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
              {data.ratioNew !== null
                ? data.ratioNew > 1
                  ? 'Part out profitable'
                  : 'Sell complete better'
                : 'No set price'}
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
              {data.ratioUsed !== null
                ? data.ratioUsed > 1
                  ? 'Part out profitable'
                  : 'Sell complete better'
                : 'No set price'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recommendation, Cache Stats, and Missing Prices */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Recommendation */}
        <Card className={isPartOut ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              {isPartOut ? (
                <TrendingUp className="h-5 w-5 text-green-600" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-600" />
              )}
              <div>
                <div className="text-sm font-medium text-muted-foreground">Recommendation</div>
                <div
                  className={`text-lg font-bold ${isPartOut ? 'text-green-700' : 'text-red-700'}`}
                  data-testid="pov-recommendation"
                >
                  {isPartOut ? 'Part Out' : 'Sell Complete'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

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
