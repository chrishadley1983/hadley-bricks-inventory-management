'use client';

import { ExternalLink, Package, Truck, Award, User } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { ArbitrageItem, AmazonOffer } from '@/lib/arbitrage/types';
import { formatCurrencyGBP } from '@/lib/arbitrage/calculations';

interface AmazonOffersModalProps {
  item: ArbitrageItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AmazonOffersModal({ item, isOpen, onClose }: AmazonOffersModalProps) {
  if (!item) return null;

  // Parse offersJson if it's a string (from database), otherwise use as-is
  const offers: AmazonOffer[] = (() => {
    if (!item.offersJson) return [];
    if (typeof item.offersJson === 'string') {
      try {
        return JSON.parse(item.offersJson);
      } catch {
        return [];
      }
    }
    return Array.isArray(item.offersJson) ? item.offersJson : [];
  })();
  const effectivePrice = item.effectiveAmazonPrice ?? item.buyBoxPrice ?? item.lowestOfferPrice;
  const hasBuyBox = item.buyBoxPrice !== null;
  const amazonUrl = item.amazonUrl ?? `https://www.amazon.co.uk/dp/${item.asin}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start gap-4">
            {/* Product Image */}
            <div className="h-[56px] w-[56px] rounded-lg border bg-muted flex items-center justify-center text-2xl flex-shrink-0">
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
              <DialogTitle className="text-base font-bold leading-tight line-clamp-2">
                {item.name ?? 'Unknown Product'}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <Badge variant="outline" className="font-mono text-xs">
                  {item.asin}
                </Badge>
                {item.bricklinkSetNumber && (
                  <Badge variant="outline" className="font-mono text-xs">
                    Set: {item.bricklinkSetNumber}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Price Summary */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 flex-shrink-0">
          <div className="grid grid-cols-3 gap-3 text-center">
            {/* Effective Price */}
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {hasBuyBox ? 'Buy Box' : 'Lowest Offer'}
              </div>
              <div className="font-mono text-lg font-bold text-green-600">
                {formatCurrencyGBP(effectivePrice)}
              </div>
              {!hasBuyBox && (
                <Badge
                  variant="outline"
                  className="text-[10px] mt-0.5 bg-amber-50 text-amber-700 border-amber-200"
                >
                  No Buy Box
                </Badge>
              )}
            </div>

            {/* WasPrice */}
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                WasPrice (90d)
              </div>
              <div className="font-mono text-lg font-bold">
                {item.wasPrice90d ? formatCurrencyGBP(item.wasPrice90d) : '—'}
              </div>
              {item.wasPrice90d && effectivePrice && item.wasPrice90d < effectivePrice && (
                <Badge
                  variant="outline"
                  className="text-[10px] mt-0.5 bg-red-50 text-red-700 border-red-200"
                >
                  +{(((effectivePrice - item.wasPrice90d) / item.wasPrice90d) * 100).toFixed(0)}%
                  above
                </Badge>
              )}
              {item.wasPrice90d && effectivePrice && item.wasPrice90d > effectivePrice && (
                <Badge
                  variant="outline"
                  className="text-[10px] mt-0.5 bg-green-50 text-green-700 border-green-200"
                >
                  {(((item.wasPrice90d - effectivePrice) / item.wasPrice90d) * 100).toFixed(0)}%
                  below
                </Badge>
              )}
            </div>

            {/* Total Offers */}
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Total Offers
              </div>
              <div className="font-mono text-lg font-bold">
                {item.totalOfferCount ?? item.offerCount ?? '—'}
              </div>
              {offers.length > 0 && offers.length < (item.totalOfferCount ?? 0) && (
                <Badge variant="outline" className="text-[10px] mt-0.5">
                  Showing {offers.length}
                </Badge>
              )}
            </div>
          </div>

          {/* Your Listing */}
          {item.yourPrice !== null && (
            <>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-blue-600" />
                  <span className="font-medium">Your Listing</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-blue-600">
                    {formatCurrencyGBP(item.yourPrice)}
                  </span>
                  <Badge
                    variant={item.buyBoxIsYours ? 'default' : 'secondary'}
                    className={cn(
                      'text-xs',
                      item.buyBoxIsYours ? 'bg-green-600' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {item.buyBoxIsYours ? 'Has Buy Box' : 'No Buy Box'}
                  </Badge>
                  <span className="text-muted-foreground text-xs">Qty: {item.yourQty ?? 0}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Offers List */}
        <div className="flex-1 min-h-0">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>All Offers</span>
            <span className="font-normal normal-case">Sorted by total price</span>
          </h4>

          {offers.length > 0 ? (
            <ScrollArea className="h-[280px] rounded-lg border">
              <div className="divide-y">
                {offers.map((offer, index) => (
                  <OfferRow
                    key={`${offer.sellerId}-${index}`}
                    offer={offer}
                    isLowest={index === 0}
                    isBuyBox={hasBuyBox && offer.totalPrice === item.buyBoxPrice}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="h-[200px] rounded-lg border flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No offer data available</p>
                <p className="text-xs mt-1">Sync pricing to fetch offer details</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-3 flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            {item.amazonSnapshotDate
              ? `Updated ${new Date(item.amazonSnapshotDate).toLocaleDateString()}`
              : 'Price data not available'}
          </div>

          <Button asChild size="sm">
            <a href={amazonUrl} target="_blank" rel="noopener noreferrer">
              View on Amazon
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface OfferRowProps {
  offer: AmazonOffer;
  isLowest: boolean;
  isBuyBox: boolean;
}

function OfferRow({ offer, isLowest, isBuyBox }: OfferRowProps) {
  const isFBA = offer.fulfillmentType === 'AFN';

  return (
    <div
      className={cn(
        'px-3 py-2 flex items-center justify-between hover:bg-muted/50',
        isLowest && 'bg-green-50/50 dark:bg-green-950/20'
      )}
    >
      <div className="flex items-center gap-3">
        {/* Badges */}
        <div className="flex flex-col gap-1">
          {isBuyBox && (
            <Badge className="text-[10px] h-5 bg-amber-500 hover:bg-amber-500">
              <Award className="h-3 w-3 mr-1" />
              Buy Box
            </Badge>
          )}
          {isLowest && !isBuyBox && (
            <Badge
              variant="outline"
              className="text-[10px] h-5 bg-green-50 text-green-700 border-green-200"
            >
              Lowest
            </Badge>
          )}
        </div>

        {/* Seller & Fulfillment */}
        <div className="min-w-[120px]">
          <div className="flex items-center gap-1.5">
            {isFBA ? (
              <Badge className="text-[10px] px-1.5 h-5 bg-orange-500 hover:bg-orange-500">
                FBA
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                FBM
              </Badge>
            )}
            {offer.isPrime && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 h-5 bg-blue-50 text-blue-700 border-blue-200"
              >
                Prime
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[140px]">
            {offer.sellerId}
          </div>
        </div>

        {/* Condition */}
        <div className="text-xs">
          <span className="text-muted-foreground">{offer.condition}</span>
          {offer.subCondition && offer.subCondition !== offer.condition && (
            <span className="text-muted-foreground"> / {offer.subCondition}</span>
          )}
        </div>
      </div>

      {/* Pricing */}
      <div className="flex items-center gap-4 text-right">
        <div className="text-xs text-muted-foreground">
          <div>Item: {formatCurrencyGBP(offer.listingPrice)}</div>
          {offer.shippingPrice > 0 && (
            <div className="flex items-center gap-1 justify-end">
              <Truck className="h-3 w-3" />+{formatCurrencyGBP(offer.shippingPrice)}
            </div>
          )}
        </div>
        <div
          className={cn(
            'font-mono font-bold text-base min-w-[70px]',
            isLowest ? 'text-green-600' : ''
          )}
        >
          {formatCurrencyGBP(offer.totalPrice)}
        </div>
      </div>
    </div>
  );
}
