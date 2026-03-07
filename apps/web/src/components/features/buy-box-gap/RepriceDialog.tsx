'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRight, Check, AlertTriangle } from 'lucide-react';
import { suggestPrice } from './BuyBoxGapTable';
import type { BuyBoxGapRow } from '@/app/api/reports/buy-box-gap/route';

interface RepriceDialogProps {
  item: BuyBoxGapRow | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function RepriceDialog({ item, onClose, onSuccess }: RepriceDialogProps) {
  const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const suggested = item ? suggestPrice(item.buyBoxPrice) : 0;

  useEffect(() => {
    if (item) {
      setPrice(suggested.toFixed(2));
      setResult(null);
    }
  }, [item, suggested]);

  const priceNum = parseFloat(price);
  const isValid = !isNaN(priceNum) && priceNum > 0;

  // Calculate profit at new price
  const profitAtNew = (() => {
    if (!isValid || !item?.inventoryCost) return null;
    const referralFee = priceNum * 0.15;
    const dst = referralFee * 0.02;
    const vatOnFees = (referralFee + dst) * 0.2;
    const totalFee = referralFee + dst + vatOnFees;
    const shipping = priceNum < 14 ? 3 : 4;
    const netPayout = priceNum - totalFee - shipping;
    const profit = netPayout - item.inventoryCost;
    return {
      profit,
      margin: (profit / priceNum) * 100,
    };
  })();

  const handleSubmit = async () => {
    if (!item || !isValid) return;
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/reports/buy-box-gap/reprice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: item.asin, newPrice: priceNum }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({ success: false, message: data.error || 'Failed to reprice' });
      } else {
        setResult({ success: true, message: data.message });
        setTimeout(() => onSuccess(), 1500);
      }
    } catch {
      setResult({ success: false, message: 'Network error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!item) return null;

  const formatGBP = (n: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);

  return (
    <Dialog open={!!item} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Reprice Listing
          </DialogTitle>
          <DialogDescription>
            Update the price for {item.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current pricing summary */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-muted-foreground text-xs">Your Price</p>
              <p className="font-semibold text-lg tabular-nums">{formatGBP(item.yourPrice)}</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-muted-foreground text-xs">Buy Box</p>
              <p className="font-semibold text-lg tabular-nums">{formatGBP(item.buyBoxPrice)}</p>
              {item.priceSource === 'was90d' && (
                <Badge variant="outline" className="text-[9px] px-1 bg-blue-50 text-blue-700 border-blue-200">
                  Was90d
                </Badge>
              )}
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-muted-foreground text-xs">COG</p>
              <p className="font-semibold text-lg tabular-nums">
                {item.inventoryCost ? formatGBP(item.inventoryCost) : '\u2014'}
              </p>
            </div>
          </div>

          {/* ASIN */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">{item.asin}</span>
            {item.setNumber && <span>{item.setNumber}</span>}
            <span>Qty: {item.yourQty}</span>
          </div>

          {/* New price input */}
          <div className="space-y-2">
            <Label htmlFor="new-price">New Price</Label>
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-muted-foreground">£</span>
              <Input
                id="new-price"
                type="number"
                step="0.01"
                min="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="text-lg font-semibold tabular-nums"
                disabled={isSubmitting}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPrice(suggested.toFixed(2))}
                disabled={isSubmitting}
                className="whitespace-nowrap text-xs"
              >
                Suggest {formatGBP(suggested)}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Suggested: nearest .49/.99 below buy box
            </p>
          </div>

          {/* Price change preview */}
          {isValid && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Price change</span>
                <span className="flex items-center gap-1 tabular-nums">
                  {formatGBP(item.yourPrice)}
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-semibold">{formatGBP(priceNum)}</span>
                  <span className={priceNum < item.yourPrice ? 'text-red-600' : 'text-green-600'}>
                    ({priceNum < item.yourPrice ? '' : '+'}
                    {formatGBP(priceNum - item.yourPrice)})
                  </span>
                </span>
              </div>
              {profitAtNew && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Profit at new price</span>
                  <span className="tabular-nums">
                    <span className={profitAtNew.margin >= 15 ? 'text-green-600 font-semibold' : profitAtNew.margin >= 5 ? 'text-amber-600 font-semibold' : 'text-red-600 font-semibold'}>
                      {profitAtNew.margin.toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground ml-1">({formatGBP(profitAtNew.profit)})</span>
                  </span>
                </div>
              )}
              {priceNum > item.buyBoxPrice && (
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Still above buy box by {formatGBP(priceNum - item.buyBoxPrice)}
                </div>
              )}
            </div>
          )}

          {/* Result message */}
          {result && (
            <div
              className={`rounded-lg p-3 text-sm ${
                result.success
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {result.success ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {result.message}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              'Update Price & Queue'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
