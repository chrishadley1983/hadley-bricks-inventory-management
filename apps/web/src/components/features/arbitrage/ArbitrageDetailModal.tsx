'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, Ban, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ArbitrageItem } from '@/lib/arbitrage/types';
import {
  formatCurrencyGBP,
  formatSalesRank,
  calculateAmazonFBMProfit,
  formatMarginPercent,
} from '@/lib/arbitrage/calculations';
import { buildBricklinkUrl } from '@/lib/arbitrage/bricklink-url';

interface ArbitrageDetailModalProps {
  item: ArbitrageItem | null;
  isOpen: boolean;
  onClose: () => void;
  onExclude: (asin: string, reason?: string) => void;
}

export function ArbitrageDetailModal({
  item,
  isOpen,
  onClose,
  onExclude,
}: ArbitrageDetailModalProps) {
  // Default buy price from BrickLink min
  const defaultBuyPrice = item?.blMinPrice ?? 0;

  // Editable buy price state
  const [buyPriceInput, setBuyPriceInput] = useState<string>(
    defaultBuyPrice > 0 ? defaultBuyPrice.toFixed(2) : ''
  );

  // Reset buy price when item changes (only when asin or blMinPrice changes, not on every render)
  useEffect(() => {
    if (item) {
      const newDefault = item.blMinPrice ?? 0;
      setBuyPriceInput(newDefault > 0 ? newDefault.toFixed(2) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only reset on asin/blMinPrice change
  }, [item?.asin, item?.blMinPrice]);

  if (!item) return null;

  // Parse the editable buy price
  const buyPrice = parseFloat(buyPriceInput) || 0;

  // Use buy_box_price if available, otherwise your_price (consistent with COG% calculations)
  const sellPrice = item.buyBoxPrice ?? item.yourPrice ?? 0;

  // Calculate Amazon FBM profit breakdown with current buy price
  const profitBreakdown = calculateAmazonFBMProfit(sellPrice, buyPrice);
  const profitIsPositive = profitBreakdown ? profitBreakdown.totalProfit > 0 : false;

  // Calculate profit margin (profit / sale price)
  const profitMarginPercent =
    profitBreakdown && sellPrice > 0
      ? (profitBreakdown.totalProfit / sellPrice) * 100
      : null;

  const bricklinkUrl = item.bricklinkSetNumber
    ? buildBricklinkUrl(item.bricklinkSetNumber)
    : null;

  const amazonUrl = item.amazonUrl ?? `https://www.amazon.co.uk/dp/${item.asin}`;

  // SellerAmp SAS web app - direct ASIN lookup
  const sellerAmpUrl = `https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${item.asin}`;

  // Check if buy price has been modified from default
  const isModified = buyPrice !== defaultBuyPrice;

  // Handle resetting to default
  const handleReset = () => {
    setBuyPriceInput(defaultBuyPrice > 0 ? defaultBuyPrice.toFixed(2) : '');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start gap-4">
            {/* Product Image */}
            <div className="h-[72px] w-[72px] rounded-lg border bg-muted flex items-center justify-center text-3xl flex-shrink-0">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.name ?? item.asin}
                  className="h-full w-full object-contain rounded-lg"
                />
              ) : (
                '📦'
              )}
            </div>

            {/* Product Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-bold leading-tight">
                  {item.name ?? 'Unknown Product'}
                </DialogTitle>
                {item.itemType === 'seeded' && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs px-2',
                      item.seededMatchConfidence && item.seededMatchConfidence >= 95
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : item.seededMatchConfidence && item.seededMatchConfidence >= 85
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    )}
                  >
                    Seeded
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Badge variant="outline" className="font-mono text-xs">
                  Set: {item.bricklinkSetNumber ?? '—'}
                </Badge>
                <Badge variant="outline" className="font-mono text-xs">
                  ASIN: {item.asin}
                </Badge>
                {item.sku && (
                  <Badge variant="outline" className="font-mono text-xs">
                    SKU: {item.sku}
                  </Badge>
                )}
                {item.itemType === 'seeded' && item.bricksetRrp != null && (
                  <Badge variant="outline" className="font-mono text-xs bg-purple-50 text-purple-700 border-purple-200">
                    RRP: {formatCurrencyGBP(item.bricksetRrp)}
                  </Badge>
                )}
                {item.itemType === 'seeded' && item.bricksetTheme && (
                  <Badge variant="outline" className="text-xs">
                    {item.bricksetTheme} ({item.bricksetYear})
                  </Badge>
                )}
                {item.itemType === 'seeded' && item.seededMatchMethod && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Match: {item.seededMatchMethod} ({item.seededMatchConfidence ?? 0}%)
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Body - scrollable content */}
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-4 py-3 pb-4">
            {/* Two-column layout for Amazon Data and BrickLink */}
            <div className="grid grid-cols-2 gap-4">
              {/* Amazon Data Section */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Amazon Data
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard
                    label="Your Price"
                    value={formatCurrencyGBP(item.yourPrice)}
                    subtext={`Qty: ${item.yourQty ?? 0}`}
                  />
                  <StatCard
                    label="Buy Box"
                    value={formatCurrencyGBP(item.buyBoxPrice)}
                    subtext={item.buyBoxIsYours ? 'You' : 'Other seller'}
                    valueClassName={
                      item.buyBoxIsYours ? 'text-green-600' : 'text-amber-600'
                    }
                  />
                  <StatCard
                    label="Sales Rank"
                    value={formatSalesRank(item.salesRank)}
                    subtext={item.salesRankCategory ?? '—'}
                  />
                  <StatCard
                    label="Offers"
                    value={String(item.offerCount ?? '—')}
                    subtext="total sellers"
                  />
                </div>
              </div>

              {/* BrickLink Data Section */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  BrickLink Stock (UK, New)
                </h4>
                <div className="rounded-lg border overflow-hidden">
                  <div className="grid grid-cols-3 divide-x bg-muted/50">
                    <div className="p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Min</div>
                      <div className="font-mono font-bold text-blue-600">
                        {formatCurrencyGBP(item.blMinPrice)}
                      </div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Avg</div>
                      <div className="font-mono font-bold text-blue-600">
                        {formatCurrencyGBP(item.blAvgPrice)}
                      </div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Max</div>
                      <div className="font-mono font-bold text-blue-600">
                        {formatCurrencyGBP(item.blMaxPrice)}
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex justify-between">
                    <span>Listings</span>
                    <span className="font-mono font-medium text-foreground">
                      {item.blTotalLots ?? 0} lots ({item.blTotalQty ?? 0} items)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Amazon Profit Calculation */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Amazon Profit Calculator
              </h4>
              <TooltipProvider>
                <div className="rounded-lg border overflow-hidden">
                  {/* Summary header - profit left, stats right */}
                  <div
                    className={cn(
                      'px-4 py-3 flex items-center justify-between',
                      profitBreakdown
                        ? profitIsPositive
                          ? 'bg-green-50 dark:bg-green-950/30'
                          : 'bg-red-50 dark:bg-red-950/30'
                        : 'bg-muted/50'
                    )}
                  >
                    {/* Left: Total Profit */}
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Total Profit
                      </div>
                      <div
                        className={cn(
                          'font-mono text-2xl font-bold',
                          profitBreakdown
                            ? profitIsPositive
                              ? 'text-green-600'
                              : 'text-red-600'
                            : 'text-muted-foreground'
                        )}
                      >
                        {profitBreakdown
                          ? formatCurrencyGBP(profitBreakdown.totalProfit)
                          : '—'}
                      </div>
                    </div>

                    {/* Right: Stats grid */}
                    {profitBreakdown && (
                      <div className="grid grid-cols-3 gap-4 text-right">
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase">Margin</div>
                          <div className={cn(
                            'font-mono text-base font-semibold',
                            profitMarginPercent !== null && profitMarginPercent >= 25
                              ? 'text-green-600'
                              : profitMarginPercent !== null && profitMarginPercent >= 15
                                ? 'text-amber-600'
                                : 'text-red-600'
                          )}>
                            {formatMarginPercent(profitMarginPercent)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase">Take Home</div>
                          <div className="font-mono text-base font-semibold">
                            {formatCurrencyGBP(profitBreakdown.netPayout)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase">COG %</div>
                          <div className={cn(
                            'font-mono text-base font-semibold',
                            sellPrice > 0 && (buyPrice / sellPrice) * 100 < 40
                              ? 'text-green-600'
                              : sellPrice > 0 && (buyPrice / sellPrice) * 100 <= 50
                                ? 'text-amber-600'
                                : 'text-red-600'
                          )}>
                            {sellPrice > 0 ? `${((buyPrice / sellPrice) * 100).toFixed(1)}%` : '—'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Compact breakdown */}
                  <div className="p-2 space-y-1 text-sm">
                    {/* Buy Price - EDITABLE (first) */}
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-1">
                        <span className="font-medium">Buy Price (BL)</span>
                        {isModified && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1 text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={handleReset}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                        {isModified && (
                          <span className="text-[10px] text-blue-600">
                            was {formatCurrencyGBP(defaultBuyPrice)}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground text-xs">£</span>
                        <Input
                          type="number"
                          step="0.50"
                          min="0"
                          value={buyPriceInput}
                          onChange={(e) => setBuyPriceInput(e.target.value)}
                          className={cn(
                            'w-20 h-7 font-mono text-right text-red-600 font-medium text-sm',
                            isModified && 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                          )}
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    {/* Sale price */}
                    <div className="flex justify-between pt-1 border-t">
                      <span>Sale Price (Amazon)</span>
                      <span className="font-mono font-medium">
                        {formatCurrencyGBP(sellPrice)}
                      </span>
                    </div>

                    {/* Fees - condensed */}
                    {profitBreakdown && (
                      <>
                        <div className="flex justify-between text-muted-foreground text-xs">
                          <span>Referral (15%) + DST (2%) + VAT (20%)</span>
                          <span className="font-mono text-red-500">
                            -{formatCurrencyGBP(profitBreakdown.totalAmazonFee)}
                          </span>
                        </div>
                        <div className="flex justify-between text-muted-foreground text-xs">
                          <span>Shipping (FBM)</span>
                          <span className="font-mono text-red-500">
                            -{formatCurrencyGBP(profitBreakdown.shippingCost)}
                          </span>
                        </div>
                      </>
                    )}

                    {!profitBreakdown && (
                      <div className="text-center text-muted-foreground py-2 text-xs">
                        Enter a buy price to calculate profit
                      </div>
                    )}
                  </div>
                </div>
              </TooltipProvider>
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4 flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            {item.blSnapshotDate
              ? `Prices updated ${new Date(item.blSnapshotDate).toLocaleDateString()}`
              : 'Price data not available'}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExclude(item.asin)}
            >
              <Ban className="mr-2 h-4 w-4" />
              Exclude
            </Button>

            <Button asChild variant="outline" size="sm">
              <a href={amazonUrl} target="_blank" rel="noopener noreferrer">
                Amazon
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>

            <Button
              asChild
              variant="outline"
              size="sm"
              className="bg-blue-50 hover:bg-blue-100 border-blue-200"
            >
              <a href={sellerAmpUrl} target="_blank" rel="noopener noreferrer">
                SellerAmp
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>

            {bricklinkUrl && (
              <Button
                asChild
                className="bg-orange-600 hover:bg-orange-700"
                size="sm"
              >
                <a href={bricklinkUrl} target="_blank" rel="noopener noreferrer">
                  BrickLink
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  subtext: string;
  valueClassName?: string;
}

function StatCard({ label, value, subtext, valueClassName }: StatCardProps) {
  return (
    <div className="rounded-lg bg-muted/50 p-2 text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className={cn('font-mono text-base font-bold mt-0.5', valueClassName)}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground truncate">{subtext}</div>
    </div>
  );
}
