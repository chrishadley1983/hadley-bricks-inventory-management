'use client';

import * as React from 'react';
import {
  ArrowLeft,
  Save,
  AlertTriangle,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PurchaseEvaluation, EvaluationItem, TargetPlatform } from '@/lib/purchase-evaluator';
import { formatCurrencyGBP } from '@/lib/arbitrage/calculations';
import type { EvaluationMode } from '../PurchaseEvaluatorWizard';
import { calculateMaxPurchasePriceEbay, calculateMaxPurchasePriceAmazon } from '@/lib/purchase-evaluator/reverse-calculations';

interface ReviewStepProps {
  evaluation: PurchaseEvaluation;
  evaluationMode?: EvaluationMode;
  targetMarginPercent?: number;
  onSave: () => void;
  onBack: () => void;
  onUpdateItems?: (updates: Array<{
    id: string;
    allocatedCost?: number | null;
    amazonAsin?: string;
    targetPlatform?: TargetPlatform;
    userSellPriceOverride?: number | null;
  }>) => Promise<void>;
  onRecalculateCosts?: () => Promise<void>;
}

/**
 * Get the sell price based on target platform
 */
function getSellPrice(item: EvaluationItem): number | null {
  if (item.userSellPriceOverride && item.userSellPriceOverride > 0) {
    return item.userSellPriceOverride;
  }
  if (item.targetPlatform === 'ebay') {
    return item.ebaySoldAvgPrice || item.ebayAvgPrice || null;
  }
  // Amazon - use Buy Box, fall back to Was Price
  return item.amazonBuyBoxPrice || item.amazonWasPrice || null;
}

/**
 * Calculate max purchase price for an item based on expected sell price and target margin
 */
function getMaxPurchasePrice(item: EvaluationItem, targetMarginPercent: number): number | null {
  const sellPrice = getSellPrice(item);
  if (!sellPrice || sellPrice <= 0) return null;

  if (item.targetPlatform === 'ebay') {
    const result = calculateMaxPurchasePriceEbay(sellPrice, targetMarginPercent);
    return result.maxPurchasePrice;
  } else {
    const result = calculateMaxPurchasePriceAmazon(sellPrice, targetMarginPercent);
    return result.maxPurchasePrice;
  }
}

/**
 * Review step showing all pricing data and profitability
 */
export function ReviewStep({
  evaluation,
  evaluationMode = 'cost_known',
  targetMarginPercent = 30,
  onSave,
  onBack,
  onUpdateItems,
  onRecalculateCosts,
}: ReviewStepProps) {
  const items = evaluation.items || [];
  const [editingCosts, setEditingCosts] = React.useState<Record<string, string>>({});
  const [editingPrices, setEditingPrices] = React.useState<Record<string, string>>({});
  const [isRecalculating, setIsRecalculating] = React.useState(false);
  const [pendingUpdates, setPendingUpdates] = React.useState<Record<string, {
    allocatedCost?: number | null;
    amazonAsin?: string;
    targetPlatform?: TargetPlatform;
    userSellPriceOverride?: number | null;
  }>>({});

  // Calculate summary stats
  const itemsNeedingReview = items.filter((item) => item.needsReview).length;
  // Items with no data: no sell price available AND no user override AND no allocated cost
  const itemsWithNoData = items.filter((item) => {
    // If user has set a price override, the item has data
    if (item.userSellPriceOverride && item.userSellPriceOverride > 0) return false;
    // If allocated cost is set, the item has data
    if (item.allocatedCost && item.allocatedCost > 0) return false;
    // Check platform-specific pricing
    if (item.targetPlatform === 'ebay') {
      return !item.ebaySoldAvgPrice && !item.ebayAvgPrice;
    }
    return !item.amazonBuyBoxPrice && !item.amazonWasPrice;
  }).length;

  // Calculate total expected profit from grossProfit (which accounts for platform fees)
  const totalExpectedProfit = items.reduce((sum, item) => sum + (item.grossProfit || 0), 0);

  // For max_bid mode: Calculate total max purchase price
  const totalMaxPurchasePrice = evaluationMode === 'max_bid'
    ? items.reduce((sum, item) => {
        const maxPrice = getMaxPurchasePrice(item, targetMarginPercent);
        return sum + (maxPrice || 0);
      }, 0)
    : 0;

  // For max_bid mode: Calculate expected revenue from sell prices
  const calculatedExpectedRevenue = items.reduce((sum, item) => {
    const sellPrice = getSellPrice(item);
    return sum + ((sellPrice || 0) * (item.quantity || 1));
  }, 0);

  // Count items with calculable max price
  const itemsWithMaxPrice = evaluationMode === 'max_bid'
    ? items.filter((item) => getMaxPurchasePrice(item, targetMarginPercent) !== null).length
    : 0;

  // Format percentage with color
  const formatPercent = (value: number | null, inverse?: boolean) => {
    if (value === null) return <span className="text-muted-foreground">-</span>;
    const isPositive = inverse ? value < 50 : value > 0;
    return (
      <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
        {value.toFixed(1)}%
      </span>
    );
  };

  // Build Amazon URL
  const buildAmazonUrl = (asin: string) => `https://www.amazon.co.uk/dp/${asin}`;

  // Build eBay search URL
  const buildEbayUrl = (setNumber: string) =>
    `https://www.ebay.co.uk/sch/i.html?_nkw=LEGO+${setNumber}`;

  // Handle cost change (direct override)
  const handleCostChange = (itemId: string, value: string) => {
    setEditingCosts((prev) => ({ ...prev, [itemId]: value }));
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setPendingUpdates((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], allocatedCost: numValue },
      }));
    }
  };

  // Handle price change (sell price override)
  const handlePriceChange = (itemId: string, value: string) => {
    setEditingPrices((prev) => ({ ...prev, [itemId]: value }));
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setPendingUpdates((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], userSellPriceOverride: numValue },
      }));
    } else if (value === '') {
      // Clear override when empty
      setPendingUpdates((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], userSellPriceOverride: null },
      }));
    }
  };

  // Handle platform change
  const handlePlatformChange = (itemId: string, platform: TargetPlatform) => {
    setPendingUpdates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], targetPlatform: platform },
    }));
  };

  // Handle ASIN selection
  const handleAsinSelect = (itemId: string, asin: string) => {
    setPendingUpdates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], amazonAsin: asin },
    }));
  };

  // Apply pending updates
  const handleApplyUpdates = async () => {
    if (Object.keys(pendingUpdates).length === 0 || !onUpdateItems) return;

    const updates = Object.entries(pendingUpdates).map(([id, update]) => ({
      id,
      ...update,
    }));

    await onUpdateItems(updates);
    setPendingUpdates({});
    setEditingCosts({});
    setEditingPrices({});
  };

  // Recalculate costs
  const handleRecalculateCosts = async () => {
    if (!onRecalculateCosts) return;
    setIsRecalculating(true);
    try {
      await onRecalculateCosts();
    } finally {
      setIsRecalculating(false);
    }
  };

  const hasPendingUpdates = Object.keys(pendingUpdates).length > 0;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>
            {evaluationMode === 'max_bid' ? 'Maximum Bid Recommendation' : 'Evaluation Summary'}
          </CardTitle>
          <CardDescription>
            {evaluationMode === 'max_bid'
              ? `Based on ${targetMarginPercent}% target margin for ${itemsWithMaxPrice}/${items.length} items with pricing data`
              : evaluation.name || `Evaluation from ${new Date(evaluation.createdAt).toLocaleDateString()}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {evaluationMode === 'max_bid' ? (
            // Max Bid Mode Summary
            <div className="grid gap-4 md:grid-cols-3">
              <div className="text-center p-6 bg-primary/5 border-2 border-primary rounded-lg">
                <p className="text-3xl font-bold text-primary">
                  {formatCurrencyGBP(totalMaxPurchasePrice)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Maximum Purchase Price</p>
                <p className="text-xs text-muted-foreground">
                  For {targetMarginPercent}% profit margin
                </p>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{formatCurrencyGBP(calculatedExpectedRevenue)}</p>
                <p className="text-sm text-muted-foreground">Expected Revenue</p>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{items.length}</p>
                <p className="text-sm text-muted-foreground">Items Identified</p>
              </div>
            </div>
          ) : (
            // Traditional Mode Summary
            <div className="grid gap-4 md:grid-cols-4">
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{formatCurrencyGBP(evaluation.totalCost)}</p>
                <p className="text-sm text-muted-foreground">Total Cost</p>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold">{formatCurrencyGBP(evaluation.totalExpectedRevenue)}</p>
                <p className="text-sm text-muted-foreground">Expected Revenue</p>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className={`text-2xl font-bold ${totalExpectedProfit > 0 ? 'text-green-600' : totalExpectedProfit < 0 ? 'text-red-600' : ''}`}>
                  {totalExpectedProfit !== 0 ? formatCurrencyGBP(totalExpectedProfit) : '-'}
                </p>
                <p className="text-sm text-muted-foreground">Est. Profit (after fees)</p>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <p className={`text-2xl font-bold ${(evaluation.overallMarginPercent ?? 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {evaluation.overallMarginPercent?.toFixed(1) ?? '-'}%
                </p>
                <p className="text-sm text-muted-foreground">Margin</p>
              </div>
            </div>
          )}

          {/* Warnings */}
          <div className="mt-4 space-y-2">
            {itemsNeedingReview > 0 && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                <p className="text-sm text-yellow-800">
                  <strong>{itemsNeedingReview}</strong> item(s) need review (multiple ASIN matches found)
                </p>
              </div>
            )}
            {itemsWithNoData > 0 && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">
                  <strong>{itemsWithNoData}</strong> item(s) have no Amazon pricing data - enter cost manually or switch to eBay
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Items ({items.length})</CardTitle>
            <CardDescription>
              {evaluationMode === 'max_bid'
                ? 'Review identified items and their maximum purchase prices'
                : 'Review pricing data and profitability for each item'}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {hasPendingUpdates && onUpdateItems && (
              <Button variant="outline" size="sm" onClick={handleApplyUpdates}>
                Apply Changes
              </Button>
            )}
            {onRecalculateCosts && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRecalculateCosts}
                disabled={isRecalculating}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isRecalculating ? 'animate-spin' : ''}`} />
                Recalculate Costs
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] w-full">
            <div className="min-w-[1300px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px] sticky left-0 bg-background">Set #</TableHead>
                    <TableHead className="w-[160px]">Name</TableHead>
                    <TableHead className="w-[50px]">Cond</TableHead>
                    <TableHead className="w-[40px]">Qty</TableHead>
                    <TableHead className="w-[90px]">Platform</TableHead>
                    <TableHead className="w-[100px]">ASIN</TableHead>
                    {evaluationMode === 'max_bid' ? (
                      <>
                        <TableHead className="w-[90px]">Sell Price</TableHead>
                        <TableHead className="w-[90px] bg-primary/5">Max Bid</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="w-[90px]">Cost</TableHead>
                        <TableHead className="w-[90px]">Price</TableHead>
                      </>
                    )}
                    <TableHead className="w-[70px]">Buy Box</TableHead>
                    <TableHead className="w-[70px]">Was Price</TableHead>
                    <TableHead className="w-[70px]">eBay Sold</TableHead>
                    {evaluationMode !== 'max_bid' && (
                      <>
                        <TableHead className="w-[60px]">COG%</TableHead>
                        <TableHead className="w-[60px]">Margin</TableHead>
                      </>
                    )}
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const sellPrice = getSellPrice(item);
                    const hasAlternatives = item.amazonAlternativeAsins && item.amazonAlternativeAsins.length > 0;
                    const currentCost = editingCosts[item.id] ?? (item.allocatedCost ?? item.unitCost ?? '');
                    const currentPlatform = pendingUpdates[item.id]?.targetPlatform ?? item.targetPlatform;
                    const currentPrice = editingPrices[item.id] ?? (item.userSellPriceOverride ?? sellPrice ?? '');

                    // Determine if item has no pricing data (considering platform and user overrides)
                    const hasUserOverride = item.userSellPriceOverride && item.userSellPriceOverride > 0;
                    const hasNoData = !hasUserOverride && !item.allocatedCost && (
                      item.targetPlatform === 'ebay'
                        ? !item.ebaySoldAvgPrice && !item.ebayAvgPrice
                        : !item.amazonBuyBoxPrice && !item.amazonWasPrice
                    );

                    return (
                      <TableRow
                        key={item.id}
                        className={
                          hasNoData
                            ? 'bg-red-50'
                            : item.needsReview
                              ? 'bg-yellow-50'
                              : ''
                        }
                      >
                        <TableCell className="font-mono text-xs sticky left-0 bg-background">
                          {item.setNumber}
                          {hasNoData && (
                            <AlertCircle className="inline h-3 w-3 ml-1 text-red-600" />
                          )}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate text-xs" title={item.setName || ''}>
                          {item.setName || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.condition === 'New' ? 'default' : 'secondary'} className="text-xs">
                            {item.condition === 'New' ? 'N' : 'U'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{item.quantity}</TableCell>
                        <TableCell>
                          <Select
                            value={currentPlatform}
                            onValueChange={(v: string) => handlePlatformChange(item.id, v as TargetPlatform)}
                          >
                            <SelectTrigger className="h-7 w-[80px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="amazon" className="text-xs">Amazon</SelectItem>
                              <SelectItem value="ebay" className="text-xs">eBay</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {item.amazonAsin ? (
                            <div className="flex items-center gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <a
                                      href={buildAmazonUrl(item.amazonAsin)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-xs text-blue-600 hover:underline"
                                    >
                                      {item.amazonAsin.slice(0, 10)}
                                    </a>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {item.amazonAsinConfidence === 'multiple' && (
                                      <p className="text-yellow-600">Multiple matches - select correct ASIN</p>
                                    )}
                                    <p>Source: {item.amazonAsinSource}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              {hasAlternatives && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                                      <ChevronDown className="h-3 w-3" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start" className="w-64">
                                    <DropdownMenuItem
                                      onClick={() => handleAsinSelect(item.id, item.amazonAsin!)}
                                      className="text-xs"
                                    >
                                      <span className="font-mono">{item.amazonAsin}</span>
                                      <span className="ml-2 text-muted-foreground">(current)</span>
                                    </DropdownMenuItem>
                                    {item.amazonAlternativeAsins?.map((alt) => (
                                      <DropdownMenuItem
                                        key={alt.asin}
                                        onClick={() => handleAsinSelect(item.id, alt.asin)}
                                        className="text-xs"
                                      >
                                        <div className="flex flex-col">
                                          <span className="font-mono">{alt.asin}</span>
                                          <span className="text-muted-foreground truncate max-w-[200px]">
                                            {alt.title}
                                          </span>
                                        </div>
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              {item.needsReview && !hasAlternatives && (
                                <AlertTriangle className="h-3 w-3 text-yellow-600" />
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                        {evaluationMode === 'max_bid' ? (
                          // Max Bid Mode: Show editable sell price and calculated max bid
                          <>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-[75px] h-7 text-xs"
                                value={currentPrice}
                                onChange={(e) => handlePriceChange(item.id, e.target.value)}
                                placeholder={sellPrice?.toFixed(2) || '0.00'}
                              />
                            </TableCell>
                            <TableCell className="bg-primary/5">
                              {(() => {
                                // Use the current price (which includes pending edits) for max bid calculation
                                const effectiveSellPrice = typeof currentPrice === 'string' && currentPrice !== ''
                                  ? parseFloat(currentPrice)
                                  : sellPrice;

                                if (!effectiveSellPrice || effectiveSellPrice <= 0) {
                                  return <span className="text-muted-foreground text-xs">-</span>;
                                }

                                // Calculate max bid based on platform
                                const platform = pendingUpdates[item.id]?.targetPlatform ?? item.targetPlatform;
                                const maxBid = platform === 'ebay'
                                  ? calculateMaxPurchasePriceEbay(effectiveSellPrice, targetMarginPercent).maxPurchasePrice
                                  : calculateMaxPurchasePriceAmazon(effectiveSellPrice, targetMarginPercent).maxPurchasePrice;

                                return (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="font-semibold text-primary text-xs cursor-help">
                                          {formatCurrencyGBP(maxBid)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        <div className="space-y-1 text-xs">
                                          <p className="font-semibold">Max Bid Breakdown</p>
                                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                            <span className="text-muted-foreground">Expected Sell:</span>
                                            <span>{formatCurrencyGBP(effectiveSellPrice)}</span>
                                            <span className="text-muted-foreground">Platform Fees:</span>
                                            <span>
                                              {platform === 'ebay'
                                                ? '~15.7% + £0.30'
                                                : '~15% + £3-4'}
                                            </span>
                                            <span className="text-muted-foreground">Target Margin:</span>
                                            <span>{targetMarginPercent}%</span>
                                            <span className="text-muted-foreground font-semibold border-t pt-1">Max Bid:</span>
                                            <span className="font-semibold text-primary border-t pt-1">
                                              {formatCurrencyGBP(maxBid)}
                                            </span>
                                          </div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              })()}
                            </TableCell>
                          </>
                        ) : (
                          // Traditional Mode: Show editable cost and price
                          <>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-[75px] h-7 text-xs"
                                value={currentCost}
                                onChange={(e) => handleCostChange(item.id, e.target.value)}
                                placeholder="0.00"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-[75px] h-7 text-xs"
                                value={currentPrice}
                                onChange={(e) => handlePriceChange(item.id, e.target.value)}
                                placeholder={sellPrice?.toFixed(2) || '0.00'}
                              />
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-xs">
                          {item.amazonBuyBoxPrice ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help underline decoration-dotted">
                                    {formatCurrencyGBP(item.amazonBuyBoxPrice)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <div className="space-y-1 text-xs">
                                    <p className="font-semibold">Amazon Listing Details</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                      <span className="text-muted-foreground">Buy Box:</span>
                                      <span>{formatCurrencyGBP(item.amazonBuyBoxPrice)}</span>
                                      {item.amazonSalesRank && (
                                        <>
                                          <span className="text-muted-foreground">Sales Rank:</span>
                                          <span>#{item.amazonSalesRank.toLocaleString()}</span>
                                        </>
                                      )}
                                      {item.amazonOfferCount !== null && (
                                        <>
                                          <span className="text-muted-foreground">Sellers:</span>
                                          <span>{item.amazonOfferCount} offer{item.amazonOfferCount !== 1 ? 's' : ''}</span>
                                        </>
                                      )}
                                      {item.amazonWasPrice && (
                                        <>
                                          <span className="text-muted-foreground">Was Price:</span>
                                          <span>{formatCurrencyGBP(item.amazonWasPrice)}</span>
                                        </>
                                      )}
                                    </div>
                                    {item.amazonSalesRank && (
                                      <p className="text-[10px] text-muted-foreground pt-1 border-t">
                                        {item.amazonSalesRank < 50000 ? '🔥 Hot seller' :
                                         item.amazonSalesRank < 200000 ? '✓ Good velocity' :
                                         item.amazonSalesRank < 500000 ? '⚠️ Slower mover' : '❄️ Low velocity'}
                                      </p>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatCurrencyGBP(item.amazonWasPrice)}</TableCell>
                        <TableCell className="text-xs">
                          {item.ebaySoldAvgPrice ? (
                            formatCurrencyGBP(item.ebaySoldAvgPrice)
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        {evaluationMode !== 'max_bid' && (
                          <>
                            <TableCell className="text-xs">{formatPercent(item.cogPercent, true)}</TableCell>
                            <TableCell>
                          {item.profitMarginPercent !== null && item.grossProfit !== null ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="flex items-center gap-1 text-xs cursor-help">
                                    {item.profitMarginPercent > 0 ? (
                                      <TrendingUp className="h-3 w-3 text-green-600" />
                                    ) : (
                                      <TrendingDown className="h-3 w-3 text-red-600" />
                                    )}
                                    {formatPercent(item.profitMarginPercent)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <div className="space-y-1 text-xs">
                                    <p className="font-semibold">Profit Breakdown</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                      <span className="text-muted-foreground">Sell Price:</span>
                                      <span>{formatCurrencyGBP(sellPrice)}</span>
                                      <span className="text-muted-foreground">Cost:</span>
                                      <span>{formatCurrencyGBP(item.allocatedCost ?? item.unitCost)}</span>
                                      <span className="text-muted-foreground">Platform Fees:</span>
                                      <span>
                                        {sellPrice && (item.allocatedCost ?? item.unitCost)
                                          ? formatCurrencyGBP(
                                              sellPrice - (item.allocatedCost ?? item.unitCost ?? 0) - (item.grossProfit ?? 0)
                                            )
                                          : '-'}
                                      </span>
                                      <span className="text-muted-foreground font-semibold border-t pt-1">Net Profit:</span>
                                      <span className={`font-semibold border-t pt-1 ${(item.grossProfit ?? 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatCurrencyGBP(item.grossProfit)}
                                      </span>
                                    </div>
                                    <p className="text-muted-foreground pt-1 text-[10px]">
                                      {item.targetPlatform === 'ebay'
                                        ? 'eBay fees: 12.8% FVF + 0.36% reg + 2.5% payment + £0.30 + ~£4 shipping'
                                        : 'Amazon FBM fees: ~15% referral + £3-4 shipping'}
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                            </TableCell>
                          </>
                        )}
                        <TableCell>
                          <a
                            href={item.amazonAsin ? buildAmazonUrl(item.amazonAsin) : buildEbayUrl(item.setNumber)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-primary" />
                          </a>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          {hasPendingUpdates && onUpdateItems && (
            <Button variant="outline" onClick={handleApplyUpdates}>
              Apply Changes
            </Button>
          )}
          <Button onClick={async () => {
            // Apply any pending updates before saving
            if (hasPendingUpdates && onUpdateItems) {
              await handleApplyUpdates();
            }
            onSave();
          }}>
            <Save className="mr-2 h-4 w-4" />
            Save Evaluation
          </Button>
        </div>
      </div>
    </div>
  );
}
