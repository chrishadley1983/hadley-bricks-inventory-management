'use client';

import * as React from 'react';
import { CheckCircle2, Plus, List, Calculator, TrendingUp, TrendingDown, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PurchaseEvaluation, EvaluationItem } from '@/lib/purchase-evaluator';
import { formatCurrencyGBP } from '@/lib/arbitrage/calculations';
import type { AuctionSettings } from '@/lib/purchase-evaluator/photo-types';
import { DEFAULT_AUCTION_SETTINGS } from '@/lib/purchase-evaluator/photo-types';
import {
  calculateMaxPurchasePriceAmazon,
  calculateMaxPurchasePriceEbay,
  calculatePlatformFeesOnly,
  calculateAuctionMaxBidFromRevenue,
} from '@/lib/purchase-evaluator/reverse-calculations';

interface SavedStepProps {
  evaluationId: string | null;
  evaluation?: PurchaseEvaluation | null;
  evaluationMode?: 'cost_known' | 'max_bid';
  targetMarginPercent?: number;
  auctionSettings?: AuctionSettings;
  onNewEvaluation: () => void;
  onViewAll: () => void;
  onUpdateActualCost?: (actualCost: number) => Promise<void>;
}

/**
 * Get the sell price for an item based on target platform
 */
function getSellPrice(item: EvaluationItem): number | null {
  if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
    return item.userSellPriceOverride;
  }
  if (item.targetPlatform === 'ebay') {
    return item.ebaySoldAvgPrice || item.ebayAvgPrice || null;
  }
  return item.amazonBuyBoxPrice || item.amazonWasPrice || null;
}


/**
 * Final step showing success message after saving
 * Enhanced for max_bid mode to allow entering actual cost and see profit
 */
export function SavedStep({
  evaluationId: _evaluationId,
  evaluation,
  evaluationMode = 'cost_known',
  targetMarginPercent = 30,
  auctionSettings = DEFAULT_AUCTION_SETTINGS,
  onNewEvaluation,
  onViewAll,
  onUpdateActualCost,
}: SavedStepProps) {
  const [actualCost, setActualCost] = React.useState<string>('');
  const [isUpdating, setIsUpdating] = React.useState(false);

  // Calculate totals for max_bid mode
  const items = evaluation?.items || [];

  // Calculate expected revenue from sell prices
  const totalExpectedRevenue = items.reduce((sum, item) => {
    const sellPrice = getSellPrice(item);
    return sum + ((sellPrice || 0) * (item.quantity || 1));
  }, 0);

  // Calculate total platform fees using the dedicated function (consistent with ReviewStep)
  const totalFees = items.reduce((sum, item) => {
    const sellPrice = getSellPrice(item);
    if (!sellPrice) return sum;
    const feeResult = calculatePlatformFeesOnly(sellPrice, item.targetPlatform);
    return sum + (feeResult.total * (item.quantity || 1));
  }, 0);

  // Calculate max purchase price for non-auction mode display
  const totalMaxPurchasePrice = items.reduce((sum, item) => {
    const sellPrice = getSellPrice(item);
    if (!sellPrice || sellPrice <= 0) return sum;

    const result = item.targetPlatform === 'ebay'
      ? calculateMaxPurchasePriceEbay(sellPrice, targetMarginPercent)
      : calculateMaxPurchasePriceAmazon(sellPrice, targetMarginPercent);

    return sum + (result.maxPurchasePrice * (item.quantity || 1));
  }, 0);

  // Calculate auction breakdown using the CORRECT method
  // This calculates max bid from revenue - fees - target profit, avoiding double-accounting
  const auctionBreakdown = auctionSettings.enabled
    ? calculateAuctionMaxBidFromRevenue(
        totalExpectedRevenue,
        totalFees,
        targetMarginPercent,
        auctionSettings.commissionPercent,
        auctionSettings.shippingCost
      )
    : null;

  // Calculate profit based on actual cost entered
  const actualCostNum = parseFloat(actualCost) || 0;
  const actualProfit = actualCostNum > 0 ? totalExpectedRevenue - totalFees - actualCostNum : null;
  const actualMargin = actualCostNum > 0 && totalExpectedRevenue > 0
    ? ((actualProfit || 0) / totalExpectedRevenue) * 100
    : null;

  // Handle updating actual cost
  const handleUpdateCost = async () => {
    if (!onUpdateActualCost || actualCostNum <= 0) return;

    setIsUpdating(true);
    try {
      await onUpdateActualCost(actualCostNum);
    } finally {
      setIsUpdating(false);
    }
  };

  // Standard mode - just show success
  if (evaluationMode !== 'max_bid') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-12">
          <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-lg font-medium">Evaluation Saved!</p>
          <p className="text-muted-foreground mb-6 text-center">
            Your purchase evaluation has been saved. You can view it anytime from your evaluations list.
          </p>
          <div className="flex gap-4">
            <Button variant="outline" onClick={onNewEvaluation}>
              <Plus className="mr-2 h-4 w-4" />
              New Evaluation
            </Button>
            <Button onClick={onViewAll}>
              <List className="mr-2 h-4 w-4" />
              View All Evaluations
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Max Bid mode - show actual cost input and profit calculation
  return (
    <div className="space-y-6">
      {/* Success Banner */}
      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-lg font-medium">Evaluation Saved!</p>
            <p className="text-sm text-muted-foreground">
              {auctionBreakdown
                ? `Your photo-based evaluation has been saved with max bid: ${formatCurrencyGBP(auctionBreakdown.maxBid)}`
                : `Your photo-based evaluation has been saved with max purchase price: ${formatCurrencyGBP(totalMaxPurchasePrice)}`}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Auction Summary - only show if auction mode was enabled */}
      {auctionBreakdown && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gavel className="h-4 w-4" />
              Auction Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="text-center p-4 rounded-lg bg-primary/10 border-2 border-primary">
                <p className="text-2xl font-bold text-primary">{formatCurrencyGBP(auctionBreakdown.maxBid)}</p>
                <p className="text-sm text-muted-foreground">Max Bid</p>
                <p className="text-xs text-muted-foreground">Enter this amount</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-xl font-bold">{formatCurrencyGBP(auctionBreakdown.commission)}</p>
                <p className="text-sm text-muted-foreground">Commission</p>
                <p className="text-xs text-muted-foreground">{auctionSettings.commissionPercent}%</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-xl font-bold">{formatCurrencyGBP(auctionBreakdown.shippingCost)}</p>
                <p className="text-sm text-muted-foreground">Shipping</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-amber-100 border border-amber-300">
                <p className="text-xl font-bold text-amber-700">{formatCurrencyGBP(auctionBreakdown.totalPaid)}</p>
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="text-xs text-muted-foreground">Your max cost</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actual Cost Calculator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Calculate Actual Profit
          </CardTitle>
          <CardDescription>
            Enter the price you actually paid to see your expected profit and margin
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Input Section */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="space-y-2 flex-1">
              <Label htmlFor="actualCost">Actual Purchase Cost (£)</Label>
              <Input
                id="actualCost"
                type="number"
                step="0.01"
                min="0"
                placeholder="Enter what you paid..."
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                className="max-w-[200px]"
              />
            </div>
            {onUpdateActualCost && actualCostNum > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUpdateCost}
                disabled={isUpdating}
              >
                Save Cost
              </Button>
            )}
          </div>

          {/* Results Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Expected Revenue */}
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Expected Revenue</p>
              <p className="text-xl font-bold">{formatCurrencyGBP(totalExpectedRevenue)}</p>
            </div>

            {/* Platform Fees */}
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Est. Platform Fees</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrencyGBP(totalFees)}</p>
            </div>

            {/* Actual Cost */}
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Your Cost</p>
              <p className="text-xl font-bold">
                {actualCostNum > 0 ? formatCurrencyGBP(actualCostNum) : '—'}
              </p>
              {actualCostNum > 0 && actualCostNum <= totalMaxPurchasePrice && (
                <p className="text-xs text-green-600 mt-1">Within max bid</p>
              )}
              {actualCostNum > 0 && actualCostNum > totalMaxPurchasePrice && (
                <p className="text-xs text-red-600 mt-1">Above max bid by {formatCurrencyGBP(actualCostNum - totalMaxPurchasePrice)}</p>
              )}
            </div>

            {/* Expected Profit */}
            <div className={`p-4 rounded-lg ${
              actualProfit !== null
                ? actualProfit > 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
                : 'bg-muted/50'
            }`}>
              <p className="text-sm text-muted-foreground">Expected Profit</p>
              <div className="flex items-center gap-2">
                {actualProfit !== null ? (
                  <>
                    {actualProfit > 0 ? (
                      <TrendingUp className="h-5 w-5 text-green-600" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-red-600" />
                    )}
                    <p className={`text-xl font-bold ${actualProfit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrencyGBP(actualProfit)}
                    </p>
                  </>
                ) : (
                  <p className="text-xl font-bold">—</p>
                )}
              </div>
              {actualMargin !== null && (
                <p className={`text-xs mt-1 ${actualMargin > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {actualMargin.toFixed(1)}% margin
                </p>
              )}
            </div>
          </div>

          {/* Comparison to Max Bid/Price */}
          {actualCostNum > 0 && (
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {auctionBreakdown ? 'Comparison to Recommended Total Paid' : 'Comparison to Recommended Max Price'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {auctionBreakdown
                      ? `Max total for ${targetMarginPercent}% margin: ${formatCurrencyGBP(auctionBreakdown.totalPaid)} (bid: ${formatCurrencyGBP(auctionBreakdown.maxBid)})`
                      : `Max price for ${targetMarginPercent}% margin: ${formatCurrencyGBP(totalMaxPurchasePrice)}`}
                  </p>
                </div>
                <div className="text-right">
                  {(() => {
                    const compareValue = auctionBreakdown ? auctionBreakdown.totalPaid : totalMaxPurchasePrice;
                    if (actualCostNum <= compareValue) {
                      return (
                        <p className="text-sm font-medium text-green-600">
                          Good deal! Saved {formatCurrencyGBP(compareValue - actualCostNum)}
                        </p>
                      );
                    } else {
                      return (
                        <p className="text-sm font-medium text-orange-600">
                          Paid {formatCurrencyGBP(actualCostNum - compareValue)} over max
                        </p>
                      );
                    }
                  })()}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-center gap-4">
        <Button variant="outline" onClick={onNewEvaluation}>
          <Plus className="mr-2 h-4 w-4" />
          New Evaluation
        </Button>
        <Button onClick={onViewAll}>
          <List className="mr-2 h-4 w-4" />
          View All Evaluations
        </Button>
      </div>
    </div>
  );
}
