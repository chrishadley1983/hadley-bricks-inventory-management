'use client';

import { useState, useEffect, useMemo } from 'react';
import { ExternalLink, Ban, RotateCcw, Star, X, Undo2 } from 'lucide-react';
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
import {
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ArbitrageItem, EbayListing } from '@/lib/arbitrage/types';
import {
  formatCurrencyGBP,
  formatSalesRank,
  calculateAmazonFBMProfit,
  formatMarginPercent,
} from '@/lib/arbitrage/calculations';
import { buildEbaySearchUrl, buildEbayItemUrl } from '@/lib/arbitrage/ebay-url';
import { useExcludedEbayListings, useExcludeEbayListing, useRestoreEbayListing } from '@/hooks/use-arbitrage';

interface EbayDetailModalProps {
  item: ArbitrageItem | null;
  isOpen: boolean;
  onClose: () => void;
  onExclude: (asin: string, reason?: string) => void;
}

export function EbayDetailModal({
  item,
  isOpen,
  onClose,
  onExclude,
}: EbayDetailModalProps) {
  // Exclusion hooks
  const { data: excludedListings = [] } = useExcludedEbayListings(item?.bricklinkSetNumber ?? undefined);
  const excludeListingMutation = useExcludeEbayListing();
  const restoreListingMutation = useRestoreEbayListing();

  // Create a set of excluded item IDs for fast lookup
  const excludedItemIds = useMemo(
    () => new Set(excludedListings.map((e) => e.ebayItemId)),
    [excludedListings]
  );

  // Get eBay listings from the item
  const allEbayListings = (item?.ebayListings ?? []) as EbayListing[];

  // Filter out excluded listings, sort by totalPrice, and separate them
  const activeListings = useMemo(
    () => allEbayListings
      .filter((l) => !excludedItemIds.has(l.itemId))
      .sort((a, b) => a.totalPrice - b.totalPrice),
    [allEbayListings, excludedItemIds]
  );
  const excludedListingsInView = useMemo(
    () => allEbayListings.filter((l) => excludedItemIds.has(l.itemId)),
    [allEbayListings, excludedItemIds]
  );

  // Calculate min/avg/max from ACTIVE listings only (using totalPrice = price + shipping)
  const ebayStats = useMemo(() => {
    if (activeListings.length === 0) {
      return { minPrice: null, avgPrice: null, maxPrice: null, totalListings: 0 };
    }
    const prices = activeListings.map((l) => l.totalPrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    return { minPrice, avgPrice, maxPrice, totalListings: activeListings.length };
  }, [activeListings]);

  // Default buy price from minimum active listing (totalPrice includes shipping)
  const defaultBuyPrice = ebayStats.minPrice ?? 0;

  // Editable buy price state
  const [buyPriceInput, setBuyPriceInput] = useState<string>(
    defaultBuyPrice > 0 ? defaultBuyPrice.toFixed(2) : ''
  );

  // Reset buy price when item changes OR when exclusions change the min price
  useEffect(() => {
    if (item) {
      const newDefault = ebayStats.minPrice ?? 0;
      setBuyPriceInput(newDefault > 0 ? newDefault.toFixed(2) : '');
    }
  }, [item?.asin, ebayStats.minPrice]);

  if (!item) return null;

  // Parse the editable buy price
  const buyPrice = parseFloat(buyPriceInput) || 0;

  // Use your_price if available, otherwise buy_box_price
  const sellPrice = item.yourPrice ?? item.buyBoxPrice ?? 0;

  // Calculate Amazon FBM profit breakdown with current buy price
  const profitBreakdown = calculateAmazonFBMProfit(sellPrice, buyPrice);
  const profitIsPositive = profitBreakdown ? profitBreakdown.totalProfit > 0 : false;

  // Calculate profit margin (profit / sale price)
  const profitMarginPercent =
    profitBreakdown && sellPrice > 0
      ? (profitBreakdown.totalProfit / sellPrice) * 100
      : null;

  const ebaySearchUrl = item.bricklinkSetNumber
    ? buildEbaySearchUrl(item.bricklinkSetNumber)
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

  // Handler for excluding a listing
  const handleExcludeListing = (listing: EbayListing) => {
    if (!item.bricklinkSetNumber) return;
    excludeListingMutation.mutate({
      ebayItemId: listing.itemId,
      setNumber: item.bricklinkSetNumber,
      title: listing.title,
      reason: 'Not suitable for arbitrage',
    });
  };

  // Handler for restoring a listing
  const handleRestoreListing = (itemId: string) => {
    restoreListingMutation.mutate(itemId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-hidden flex flex-col">
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
              <DialogTitle className="text-lg font-bold leading-tight">
                {item.name ?? 'Unknown Product'}
              </DialogTitle>
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
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Body - scrollable content */}
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-4 py-3 pb-4">
            {/* Two-column layout for Amazon Data and eBay */}
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

              {/* eBay Data Section - uses calculated stats from active listings only */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  eBay Stock (UK, New){excludedListingsInView.length > 0 && (
                    <span className="text-[10px] font-normal ml-1">
                      — {excludedListingsInView.length} excluded
                    </span>
                  )}
                </h4>
                <div className="rounded-lg border overflow-hidden">
                  <div className="grid grid-cols-3 divide-x bg-muted/50">
                    <div className="p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Min</div>
                      <div className="font-mono font-bold text-purple-600">
                        {formatCurrencyGBP(ebayStats.minPrice)}
                      </div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Avg</div>
                      <div className="font-mono font-bold text-purple-600">
                        {formatCurrencyGBP(ebayStats.avgPrice)}
                      </div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Max</div>
                      <div className="font-mono font-bold text-purple-600">
                        {formatCurrencyGBP(ebayStats.maxPrice)}
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex justify-between">
                    <span>Listings</span>
                    <span className="font-mono font-medium text-foreground">
                      {ebayStats.totalListings} available
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Amazon Profit Calculation */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Amazon Profit Calculator (sourcing from eBay)
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
                        <span className="font-medium">Buy Price (eBay)</span>
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
                          <span className="text-[10px] text-purple-600">
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
                            isModified && 'border-purple-500 bg-purple-50 dark:bg-purple-950/30'
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

            {/* eBay Listings */}
            {allEbayListings.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  eBay Listings ({activeListings.length}{excludedListingsInView.length > 0 ? ` / ${excludedListingsInView.length} excluded` : ''})
                </h4>
                <div className="rounded-lg border overflow-hidden">
                  <div className="max-h-[200px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium w-20">Price</th>
                          <th className="px-3 py-2 text-left font-medium">Listing</th>
                          <th className="px-3 py-2 text-right font-medium w-36">Seller</th>
                          <th className="px-3 py-2 text-center font-medium w-14">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeListings.map((listing, index) => (
                          <tr key={listing.itemId} className={cn(
                            'border-t',
                            index === 0 ? 'bg-green-50/50 dark:bg-green-950/20' : ''
                          )}>
                            <td className="px-3 py-2 whitespace-nowrap w-20">
                              <span className="font-mono font-medium">
                                {formatCurrencyGBP(listing.totalPrice)}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="truncate text-xs" title={listing.title}>
                                {listing.title}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap w-36">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-xs text-muted-foreground truncate max-w-[80px]">{listing.seller}</span>
                                <Star className="h-3 w-3 text-amber-500 fill-amber-500 flex-shrink-0" />
                                <span className={cn(
                                  'text-xs flex-shrink-0',
                                  listing.sellerFeedback >= 99 ? 'text-green-600' :
                                  listing.sellerFeedback >= 95 ? 'text-amber-600' :
                                  'text-red-600'
                                )}>
                                  {listing.sellerFeedback.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center w-14">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  asChild
                                >
                                  <a
                                    href={listing.url || buildEbayItemUrl(listing.itemId)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                                  onClick={() => handleExcludeListing(listing)}
                                  disabled={excludeListingMutation.isPending}
                                  title="Exclude this listing"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Excluded listings section */}
                {excludedListingsInView.length > 0 && (
                  <div className="mt-2">
                    <details className="group">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Show {excludedListingsInView.length} excluded listing{excludedListingsInView.length !== 1 ? 's' : ''}
                      </summary>
                      <div className="mt-2 rounded-lg border border-dashed overflow-hidden opacity-60">
                        <table className="w-full text-xs">
                          <tbody>
                            {excludedListingsInView.map((listing) => (
                              <tr key={listing.itemId} className="border-t first:border-t-0 bg-muted/30">
                                <td className="px-3 py-2 whitespace-nowrap w-20">
                                  <span className="font-mono font-medium line-through">
                                    {formatCurrencyGBP(listing.totalPrice)}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="truncate text-xs line-through" title={listing.title}>
                                    {listing.title}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap w-36">
                                  <span className="text-xs text-muted-foreground truncate max-w-[80px]">{listing.seller}</span>
                                </td>
                                <td className="px-3 py-2 text-center w-14">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-muted-foreground hover:text-green-600"
                                    onClick={() => handleRestoreListing(listing.itemId)}
                                    disabled={restoreListingMutation.isPending}
                                    title="Restore this listing"
                                  >
                                    <Undo2 className="h-3 w-3" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4 flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            {item.ebaySnapshotDate
              ? `Prices updated ${new Date(item.ebaySnapshotDate).toLocaleDateString()}`
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

            {ebaySearchUrl && (
              <Button
                asChild
                className="bg-purple-600 hover:bg-purple-700"
                size="sm"
              >
                <a href={ebaySearchUrl} target="_blank" rel="noopener noreferrer">
                  eBay
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
