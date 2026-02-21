'use client';

import { ExternalLink, Package, Truck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AmazonOfferData } from './SetDetailsCard';

interface AmazonOffersModalProps {
  setNumber: string | null;
  setName: string | null;
  asin: string | null;
  offers: AmazonOfferData[];
  isOpen: boolean;
  onClose: () => void;
}

function formatCurrency(value: number | null, currency: string = 'GBP'): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(value);
}

function getConditionBadge(condition: string, subCondition: string) {
  const conditionLower = condition.toLowerCase();
  if (conditionLower === 'new') {
    return <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200">New</Badge>;
  }
  return (
    <Badge variant="secondary" className="text-[10px]">
      {condition} - {subCondition}
    </Badge>
  );
}

function getFulfillmentBadge(fulfillmentType: 'AFN' | 'MFN', isPrime: boolean) {
  if (fulfillmentType === 'AFN') {
    return (
      <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">
        <Package className="h-2.5 w-2.5 mr-1" />
        FBA
      </Badge>
    );
  }
  if (isPrime) {
    return (
      <Badge className="text-[10px] bg-blue-100 text-blue-800 border-blue-200">
        <Truck className="h-2.5 w-2.5 mr-1" />
        Prime
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      <Truck className="h-2.5 w-2.5 mr-1" />
      FBM
    </Badge>
  );
}

export function AmazonOffersModal({
  setNumber,
  setName,
  asin,
  offers,
  isOpen,
  onClose,
}: AmazonOffersModalProps) {
  if (!setNumber) return null;

  // Sort offers by total price
  const sortedOffers = [...offers].sort((a, b) => a.totalPrice - b.totalPrice);

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-lg font-bold">Amazon Offers: {setNumber}</DialogTitle>
              {setName && <p className="text-sm text-muted-foreground mt-1">{setName}</p>}
            </div>
            <div className="flex gap-2">
              <Badge
                variant="outline"
                className="font-mono text-xs border-amber-300 text-amber-700"
              >
                {offers.length} offers
              </Badge>
              {asin && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`https://www.amazon.co.uk/dp/${asin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on Amazon
                    <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Offers Table */}
        <ScrollArea className="flex-1 min-h-0">
          {sortedOffers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">No offers available.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">Seller</th>
                    <th className="px-3 py-2 text-left font-medium">Condition</th>
                    <th className="px-3 py-2 text-left font-medium">Fulfillment</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Shipping</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOffers.map((offer, index) => (
                    <tr
                      key={`${offer.sellerId}-${index}`}
                      className={`border-t hover:bg-muted/30 ${
                        index === 0 ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                      <td className="px-3 py-2">
                        <div
                          className="font-mono text-xs truncate max-w-[120px]"
                          title={offer.sellerId}
                        >
                          {offer.sellerId.slice(0, 10)}...
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {getConditionBadge(offer.condition, offer.subCondition)}
                      </td>
                      <td className="px-3 py-2">
                        {getFulfillmentBadge(offer.fulfillmentType, offer.isPrime)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatCurrency(offer.listingPrice, offer.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                        {offer.shippingPrice > 0
                          ? formatCurrency(offer.shippingPrice, offer.currency)
                          : 'Free'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold text-amber-600">
                        {formatCurrency(offer.totalPrice, offer.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {asin && (
          <div className="flex items-center justify-between border-t pt-4 flex-shrink-0 text-xs text-muted-foreground">
            <span>
              ASIN: <span className="font-mono">{asin}</span>
            </span>
            <span>Prices include VAT where applicable</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
