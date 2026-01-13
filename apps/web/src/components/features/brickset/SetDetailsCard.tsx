'use client';

import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import type { BricksetSet } from '@/lib/brickset';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface PricingStats {
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  listingCount: number;
}

interface BrickLinkPricingStats {
  minPrice: number | null;
  avgPrice: number | null;
  maxPrice: number | null;
  lotCount: number;
}

export interface AmazonOfferData {
  sellerId: string;
  condition: string;
  subCondition: string;
  fulfillmentType: 'AFN' | 'MFN';
  listingPrice: number;
  shippingPrice: number;
  totalPrice: number;
  currency: string;
  isPrime: boolean;
}

export interface SetPricingData {
  amazon: {
    buyBoxPrice: number | null;
    lowestPrice: number | null;
    wasPrice: number | null;
    offerCount: number;
    asin: string | null;
    offers: AmazonOfferData[];
  } | null;
  ebay: PricingStats | null;
  ebayUsed: PricingStats | null;
  bricklink: BrickLinkPricingStats | null;
  bricklinkUsed: BrickLinkPricingStats | null;
}

interface SetDetailsCardProps {
  set: BricksetSet;
  pricing?: SetPricingData | null;
  pricingLoading?: boolean;
  onEbayClick?: () => void;
  onEbayUsedClick?: () => void;
  onAmazonOffersClick?: () => void;
}

/**
 * Check if a string is a valid image URL
 */
function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/');
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(price);
}

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  valueClassName?: string;
}

function StatCard({ label, value, subtext, valueClassName }: StatCardProps) {
  return (
    <div className="rounded-lg bg-muted/50 p-2 text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className={`font-mono text-base font-bold mt-0.5 ${valueClassName ?? ''}`}>
        {value}
      </div>
      {subtext && (
        <div className="text-[10px] text-muted-foreground truncate">{subtext}</div>
      )}
    </div>
  );
}

export function SetDetailsCard({ set, pricing, pricingLoading, onEbayClick, onEbayUsedClick, onAmazonOffersClick }: SetDetailsCardProps) {
  return (
    <Card>
      {/* Header - Compact like arbitrage modal */}
      <CardHeader className="pb-3">
        <div className="flex items-start gap-4">
          {/* Set Image */}
          <div className="relative h-[72px] w-[72px] flex-shrink-0 overflow-hidden rounded-lg bg-muted border">
            {isValidImageUrl(set.imageUrl) ? (
              <Image
                src={set.imageUrl!}
                alt={set.setName}
                fill
                sizes="72px"
                className="object-contain"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl">
                📦
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-lg font-bold leading-tight">
                  {set.setName}
                </CardTitle>
                <CardDescription className="text-base mt-1">
                  {set.setNumber}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {set.released && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Released
                  </Badge>
                )}
                {set.availability && (
                  <Badge variant="outline">{set.availability}</Badge>
                )}
              </div>
            </div>

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="outline" className="font-mono text-xs">
                Set: {set.setNumber}
              </Badge>
              {set.ean && (
                <Badge variant="outline" className="font-mono text-xs">
                  EAN: {set.ean}
                </Badge>
              )}
              {set.upc && (
                <Badge variant="outline" className="font-mono text-xs">
                  UPC: {set.upc}
                </Badge>
              )}
              {set.ukRetailPrice && (
                <Badge variant="outline" className="font-mono text-xs bg-purple-50 text-purple-700 border-purple-200">
                  RRP: {formatPrice(set.ukRetailPrice, 'GBP')}
                </Badge>
              )}
              {set.theme && (
                <Badge variant="outline" className="text-xs">
                  {set.theme} {set.yearFrom ? `(${set.yearFrom})` : ''}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* Set Details - 2x2 grid */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard
            label="Pieces"
            value={set.pieces?.toLocaleString() ?? '—'}
          />
          <StatCard
            label="Minifigs"
            value={set.minifigs?.toString() ?? '—'}
          />
          <StatCard
            label="Year"
            value={set.yearFrom?.toString() ?? '—'}
          />
          <StatCard
            label="Rating"
            value={set.rating?.toFixed(1) ?? '—'}
            subtext={`${set.ownCount?.toLocaleString() ?? 0} owners`}
          />
        </div>

        {/* Amazon Pricing */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Amazon (UK)
          </h4>
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-3 divide-x bg-muted/50">
              <div className="p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Buy Box</div>
                <div className="font-mono font-bold text-amber-600">
                  {pricingLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : pricing?.amazon?.buyBoxPrice ? (
                    formatPrice(pricing.amazon.buyBoxPrice, 'GBP')
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div className="p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Lowest</div>
                <div className="font-mono font-bold text-amber-600">
                  {pricingLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : pricing?.amazon?.lowestPrice ? (
                    formatPrice(pricing.amazon.lowestPrice, 'GBP')
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div className="p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Was Price</div>
                <div className="font-mono font-bold text-amber-600/70">
                  {pricingLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : pricing?.amazon?.wasPrice ? (
                    formatPrice(pricing.amazon.wasPrice, 'GBP')
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            </div>
            <Separator />
            <button
              onClick={onAmazonOffersClick}
              disabled={pricingLoading || !onAmazonOffersClick || !pricing?.amazon?.offers?.length}
              className="w-full px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex justify-between hover:bg-amber-50 transition-colors disabled:cursor-default disabled:hover:bg-muted/30"
            >
              <span>Offers</span>
              <span className="font-mono font-medium text-foreground">
                {pricingLoading ? '...' : pricing?.amazon?.offerCount ?? '—'} sellers
                {onAmazonOffersClick && !pricingLoading && pricing?.amazon?.offers?.length ? (
                  <span className="ml-1 text-amber-600">(click)</span>
                ) : null}
              </span>
            </button>
          </div>
        </div>

        {/* eBay Pricing - New and Used side by side */}
        <div className="grid grid-cols-2 gap-4">
          {/* eBay New */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              eBay (UK, New)
            </h4>
            <button
              onClick={onEbayClick}
              disabled={pricingLoading || !onEbayClick}
              className="w-full text-left rounded-lg border overflow-hidden hover:border-purple-400 hover:shadow-sm transition-all cursor-pointer disabled:cursor-default disabled:hover:border-border disabled:hover:shadow-none"
            >
              <div className="grid grid-cols-3 divide-x bg-muted/50">
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Min</div>
                  <div className="font-mono font-bold text-purple-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.ebay?.minPrice ? (
                      formatPrice(pricing.ebay.minPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Avg</div>
                  <div className="font-mono font-bold text-purple-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.ebay?.avgPrice ? (
                      formatPrice(pricing.ebay.avgPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Max</div>
                  <div className="font-mono font-bold text-purple-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.ebay?.maxPrice ? (
                      formatPrice(pricing.ebay.maxPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>
              <Separator />
              <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex justify-between">
                <span>Listings</span>
                <span className="font-mono font-medium text-foreground">
                  {pricingLoading ? '...' : pricing?.ebay?.listingCount ?? '—'} available
                  {onEbayClick && !pricingLoading && <span className="ml-1 text-purple-600">(click)</span>}
                </span>
              </div>
            </button>
          </div>

          {/* eBay Used */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              eBay (UK, Used)
            </h4>
            <button
              onClick={onEbayUsedClick}
              disabled={pricingLoading || !onEbayUsedClick}
              className="w-full text-left rounded-lg border overflow-hidden hover:border-orange-400 hover:shadow-sm transition-all cursor-pointer disabled:cursor-default disabled:hover:border-border disabled:hover:shadow-none"
            >
              <div className="grid grid-cols-3 divide-x bg-muted/50">
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Min</div>
                  <div className="font-mono font-bold text-orange-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.ebayUsed?.minPrice ? (
                      formatPrice(pricing.ebayUsed.minPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Avg</div>
                  <div className="font-mono font-bold text-orange-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.ebayUsed?.avgPrice ? (
                      formatPrice(pricing.ebayUsed.avgPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Max</div>
                  <div className="font-mono font-bold text-orange-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.ebayUsed?.maxPrice ? (
                      formatPrice(pricing.ebayUsed.maxPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>
              <Separator />
              <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex justify-between">
                <span>Listings</span>
                <span className="font-mono font-medium text-foreground">
                  {pricingLoading ? '...' : pricing?.ebayUsed?.listingCount ?? '—'} available
                  {onEbayUsedClick && !pricingLoading && <span className="ml-1 text-orange-600">(click)</span>}
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* BrickLink Pricing - New and Used side by side */}
        <div className="grid grid-cols-2 gap-4">
          {/* BrickLink New */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              BrickLink (UK, New)
            </h4>
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-3 divide-x bg-muted/50">
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Min</div>
                  <div className="font-mono font-bold text-blue-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.bricklink?.minPrice ? (
                      formatPrice(pricing.bricklink.minPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Avg</div>
                  <div className="font-mono font-bold text-blue-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.bricklink?.avgPrice ? (
                      formatPrice(pricing.bricklink.avgPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Max</div>
                  <div className="font-mono font-bold text-blue-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.bricklink?.maxPrice ? (
                      formatPrice(pricing.bricklink.maxPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>
              <Separator />
              <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex justify-between">
                <span>Listings</span>
                <span className="font-mono font-medium text-foreground">
                  {pricingLoading ? '...' : pricing?.bricklink?.lotCount ?? '—'} lots
                </span>
              </div>
            </div>
          </div>

          {/* BrickLink Used */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              BrickLink (UK, Used)
            </h4>
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-3 divide-x bg-muted/50">
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Min</div>
                  <div className="font-mono font-bold text-teal-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.bricklinkUsed?.minPrice ? (
                      formatPrice(pricing.bricklinkUsed.minPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Avg</div>
                  <div className="font-mono font-bold text-teal-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.bricklinkUsed?.avgPrice ? (
                      formatPrice(pricing.bricklinkUsed.avgPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Max</div>
                  <div className="font-mono font-bold text-teal-600">
                    {pricingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : pricing?.bricklinkUsed?.maxPrice ? (
                      formatPrice(pricing.bricklinkUsed.maxPrice, 'GBP')
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>
              <Separator />
              <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground flex justify-between">
                <span>Listings</span>
                <span className="font-mono font-medium text-foreground">
                  {pricingLoading ? '...' : pricing?.bricklinkUsed?.lotCount ?? '—'} lots
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Item Numbers & Barcodes - Inline compact layout */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Identifiers
          </h4>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">US Item #:</span>
              <span className="font-mono">{set.usItemNumber || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">EU Item #:</span>
              <span className="font-mono">{set.euItemNumber || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">EAN:</span>
              <span className="font-mono">{set.ean || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">UPC:</span>
              <span className="font-mono">{set.upc || '—'}</span>
            </div>
          </div>
        </div>

        {/* Community Stats - Compact */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Community
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="Rating"
              value={set.rating?.toFixed(1) ?? '—'}
            />
            <StatCard
              label="Own It"
              value={set.ownCount?.toLocaleString() ?? '—'}
            />
            <StatCard
              label="Want It"
              value={set.wantCount?.toLocaleString() ?? '—'}
            />
          </div>
        </div>

        {/* Availability Dates - Compact inline */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Availability
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Launch:</span>
              <span>{formatDate(set.launchDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Exit:</span>
              <span>{formatDate(set.exitDate)}</span>
            </div>
          </div>
        </div>

        {/* Cache Info */}
        <div className="pt-2 border-t text-xs text-muted-foreground">
          Last updated: {formatDate(set.lastFetchedAt)}
        </div>
      </CardContent>
    </Card>
  );
}
