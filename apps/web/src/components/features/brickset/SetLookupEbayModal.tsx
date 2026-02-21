'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, Star, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { buildEbaySearchUrl, buildEbayItemUrl } from '@/lib/arbitrage/ebay-url';
import type { EbayListingItem, EbayListingsResponse } from '@/app/api/brickset/ebay-listings/route';

interface SetLookupEbayModalProps {
  setNumber: string | null;
  setName: string | null;
  condition?: 'new' | 'used';
  isOpen: boolean;
  onClose: () => void;
}

function formatCurrency(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value);
}

export function SetLookupEbayModal({
  setNumber,
  setName,
  condition = 'new',
  isOpen,
  onClose,
}: SetLookupEbayModalProps) {
  const [listings, setListings] = useState<EbayListingItem[]>([]);
  const [stats, setStats] = useState<EbayListingsResponse['stats'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch listings when modal opens
  useEffect(() => {
    if (isOpen && setNumber) {
      setLoading(true);
      setError(null);

      fetch(
        `/api/brickset/ebay-listings?setNumber=${encodeURIComponent(setNumber)}&condition=${condition}`
      )
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch eBay listings');
          return res.json();
        })
        .then((result) => {
          setListings(result.data.listings);
          setStats(result.data.stats);
        })
        .catch((err) => {
          console.error('Error fetching eBay listings:', err);
          setError(err.message);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, setNumber, condition]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setListings([]);
      setStats(null);
      setError(null);
    }
  }, [isOpen]);

  const ebaySearchUrl = setNumber ? buildEbaySearchUrl(setNumber) : null;
  const isUsed = condition === 'used';

  if (!setNumber) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-lg font-bold">
                eBay Listings ({isUsed ? 'Used' : 'New'}): {setNumber}
              </DialogTitle>
              {setName && <p className="text-sm text-muted-foreground mt-1">{setName}</p>}
            </div>
            <Badge
              variant="outline"
              className={cn(
                'font-mono text-xs',
                isUsed ? 'border-orange-300 text-orange-700' : 'border-purple-300 text-purple-700'
              )}
            >
              {listings.length} listings
            </Badge>
          </div>
        </DialogHeader>

        {/* Stats Summary */}
        {!loading && stats && stats.listingCount > 0 && (
          <div className="rounded-lg border overflow-hidden flex-shrink-0">
            <div className="grid grid-cols-3 divide-x bg-muted/50">
              <div className="p-3 text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Min Price
                </div>
                <div
                  className={cn(
                    'font-mono text-lg font-bold',
                    isUsed ? 'text-orange-600' : 'text-purple-600'
                  )}
                >
                  {formatCurrency(stats.minPrice)}
                </div>
              </div>
              <div className="p-3 text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Avg Price
                </div>
                <div
                  className={cn(
                    'font-mono text-lg font-bold',
                    isUsed ? 'text-orange-600' : 'text-purple-600'
                  )}
                >
                  {formatCurrency(stats.avgPrice)}
                </div>
              </div>
              <div className="p-3 text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Max Price
                </div>
                <div
                  className={cn(
                    'font-mono text-lg font-bold',
                    isUsed ? 'text-orange-600' : 'text-purple-600'
                  )}
                >
                  {formatCurrency(stats.maxPrice)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2
              className={cn('h-8 w-8 animate-spin', isUsed ? 'text-orange-600' : 'text-purple-600')}
            />
            <span className="ml-3 text-muted-foreground">
              Searching eBay {isUsed ? 'used' : 'new'} listings...
            </span>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* No Results */}
        {!loading && !error && listings.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-muted-foreground">No eBay listings found for this set.</p>
            {ebaySearchUrl && (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <a href={ebaySearchUrl} target="_blank" rel="noopener noreferrer">
                  Search on eBay
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        )}

        {/* Listings Table */}
        {!loading && !error && listings.length > 0 && (
          <ScrollArea className="flex-1 min-h-0">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium w-24">Price</th>
                    <th className="px-4 py-3 text-left font-medium">Listing</th>
                    <th className="px-4 py-3 text-right font-medium w-40">Seller</th>
                    <th className="px-4 py-3 text-center font-medium w-16">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((listing, index) => (
                    <tr
                      key={listing.itemId}
                      className={cn(
                        'border-t hover:bg-muted/30',
                        index === 0 ? 'bg-green-50/50 dark:bg-green-950/20' : ''
                      )}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div>
                          <span
                            className={cn(
                              'font-mono font-bold',
                              isUsed ? 'text-orange-600' : 'text-purple-600'
                            )}
                          >
                            {formatCurrency(listing.totalPrice)}
                          </span>
                          {listing.shippingCost > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              +{formatCurrency(listing.shippingCost)} P&P
                            </div>
                          )}
                          {listing.shippingCost === 0 && (
                            <div className="text-[10px] text-green-600">Free P&P</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs leading-tight max-w-[400px]" title={listing.title}>
                          {listing.title}
                        </div>
                        {listing.condition && (
                          <Badge variant="outline" className="text-[10px] mt-1">
                            {listing.condition}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-xs text-muted-foreground truncate max-w-[90px]">
                            {listing.seller}
                          </span>
                          <Star className="h-3 w-3 text-amber-500 fill-amber-500 flex-shrink-0" />
                          <span
                            className={cn(
                              'text-xs font-medium flex-shrink-0',
                              listing.sellerFeedback >= 99
                                ? 'text-green-600'
                                : listing.sellerFeedback >= 95
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                            )}
                          >
                            {listing.sellerFeedback.toFixed(1)}%
                          </span>
                        </div>
                        {listing.sellerFeedbackScore > 0 && (
                          <div className="text-[10px] text-muted-foreground text-right">
                            ({listing.sellerFeedbackScore.toLocaleString()} reviews)
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                          <a
                            href={listing.url || buildEbayItemUrl(listing.itemId)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4 flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            Showing UK listings, {isUsed ? 'Used' : 'New'} condition, Buy It Now only
          </div>
          {ebaySearchUrl && (
            <Button
              asChild
              className={cn(
                isUsed ? 'bg-orange-600 hover:bg-orange-700' : 'bg-purple-600 hover:bg-purple-700'
              )}
              size="sm"
            >
              <a href={ebaySearchUrl} target="_blank" rel="noopener noreferrer">
                View on eBay
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
