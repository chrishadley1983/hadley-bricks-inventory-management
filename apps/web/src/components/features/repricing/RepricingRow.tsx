'use client';

import { useState, useCallback, useRef } from 'react';
import { TableCell, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Package, Pencil, TrendingDown, TrendingUp, Minus, ArrowDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PushPriceButton } from './PushPriceButton';
import { ProfitCalculator } from './ProfitCalculator';
import { usePushPrice } from '@/hooks/use-repricing';
import type { RepricingItem, PushStatus } from '@/lib/repricing';
import { cn } from '@/lib/utils';

interface RepricingRowProps {
  item: RepricingItem;
}

export function RepricingRow({ item }: RepricingRowProps) {
  // Local state for editing
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrice, setEditedPrice] = useState<string>(item.yourPrice.toFixed(2));
  const [pendingPrice, setPendingPrice] = useState<number | null>(null); // Price waiting to be pushed
  const [useManualCost, setUseManualCost] = useState(false);
  const [manualCost, setManualCost] = useState<string>(
    item.inventoryCost?.toFixed(2) ?? ''
  );
  const [pushStatus, setPushStatus] = useState<PushStatus>('idle');
  const [pushError, setPushError] = useState<string | null>(null);

  const pushPrice = usePushPrice();

  // Sync editedPrice when item.yourPrice changes (e.g., after successful push)
  // Only reset if we don't have a pending edit
  const prevYourPrice = useRef(item.yourPrice);
  if (prevYourPrice.current !== item.yourPrice && pendingPrice === null) {
    setEditedPrice(item.yourPrice.toFixed(2));
    prevYourPrice.current = item.yourPrice;
  }

  // Effective price: pending edit takes priority, then item price
  const effectivePrice = pendingPrice ?? item.yourPrice;
  const effectiveCost = useManualCost
    ? parseFloat(manualCost) || null
    : item.inventoryCost;

  // Has price changed from original?
  const priceChanged = pendingPrice !== null && pendingPrice !== item.yourPrice;

  // Format currency
  const formatCurrency = (amount: number | null) => {
    if (amount === null) return '—';
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
    }).format(amount);
  };

  // Format diff with color
  const formatDiff = (diff: number | null) => {
    if (diff === null) return '—';
    const sign = diff > 0 ? '+' : '';
    return `${sign}${formatCurrency(diff)}`;
  };

  // Handle price edit start
  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
    // Start with pending price if exists, otherwise current price
    setEditedPrice((pendingPrice ?? item.yourPrice).toFixed(2));
  }, [item.yourPrice, pendingPrice]);

  // Handle price edit confirm
  const handleConfirmEdit = useCallback(() => {
    setIsEditing(false);
    const newPrice = parseFloat(editedPrice);
    if (!isNaN(newPrice) && newPrice > 0) {
      // Set pending price if different from current
      if (newPrice !== item.yourPrice) {
        setPendingPrice(newPrice);
      } else {
        setPendingPrice(null); // Clear pending if same as original
      }
    }
  }, [editedPrice, item.yourPrice]);

  // Handle price input keydown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleConfirmEdit();
      } else if (e.key === 'Escape') {
        setIsEditing(false);
        setEditedPrice((pendingPrice ?? item.yourPrice).toFixed(2));
      }
    },
    [handleConfirmEdit, item.yourPrice, pendingPrice]
  );

  // Handle push price
  const handlePushPrice = useCallback(async () => {
    if (!priceChanged || pendingPrice === null) return;

    setPushStatus('pushing');
    setPushError(null);

    try {
      await pushPrice.mutateAsync({
        sku: item.sku,
        newPrice: pendingPrice,
      });
      setPushStatus('success');
      // Clear pending price after successful push
      setPendingPrice(null);
      // Reset status after delay
      setTimeout(() => setPushStatus('idle'), 3000);
    } catch (error) {
      setPushStatus('error');
      setPushError(error instanceof Error ? error.message : 'Push failed');
    }
  }, [priceChanged, pushPrice, item.sku, pendingPrice]);

  // Toggle cost source
  const handleToggleCost = useCallback(() => {
    if (useManualCost) {
      setUseManualCost(false);
    } else {
      setUseManualCost(true);
      setManualCost(item.inventoryCost?.toFixed(2) ?? '');
    }
  }, [useManualCost, item.inventoryCost]);

  // Calculate diff based on edited price vs effective price (buy box or lowest)
  const currentDiff =
    item.effectivePrice !== null ? effectivePrice - item.effectivePrice : null;

  // Trend indicator for was price
  const getTrendIndicator = () => {
    if (item.wasPrice === null || item.buyBoxPrice === null) return null;
    const diff = item.buyBoxPrice - item.wasPrice;
    if (Math.abs(diff) < 0.5) return <Minus className="h-3 w-3 text-muted-foreground" />;
    if (diff > 0) return <TrendingUp className="h-3 w-3 text-green-600" />;
    return <TrendingDown className="h-3 w-3 text-red-600" />;
  };

  return (
    <TableRow
      className={cn(
        'hover:bg-muted/30',
        priceChanged && 'bg-blue-50/30 dark:bg-blue-950/10'
      )}
    >
      {/* ASIN */}
      <TableCell className="font-mono text-xs">
        <a
          href={`https://www.amazon.co.uk/dp/${item.asin}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {item.asin}
        </a>
      </TableCell>

      {/* SKU */}
      <TableCell className="font-mono text-xs text-muted-foreground">
        {item.sku || '—'}
      </TableCell>

      {/* Title */}
      <TableCell className="max-w-[200px]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate block text-sm">{item.title || '—'}</span>
            </TooltipTrigger>
            {item.title && (
              <TooltipContent side="top" className="max-w-[300px]">
                <p>{item.title}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Qty */}
      <TableCell className="text-right font-medium">{item.quantity}</TableCell>

      {/* Your Price (editable) */}
      <TableCell className="text-right">
        {isEditing ? (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={editedPrice}
            onChange={(e) => setEditedPrice(e.target.value)}
            onBlur={handleConfirmEdit}
            onKeyDown={handleKeyDown}
            className="h-8 w-24 font-mono text-right"
            autoFocus
          />
        ) : (
          <div className="flex items-center justify-end gap-1">
            <span
              className={cn(
                'font-mono',
                priceChanged && 'text-blue-600 font-semibold'
              )}
            >
              {formatCurrency(effectivePrice)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleStartEdit}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}
      </TableCell>

      {/* Buy Box / Lowest */}
      <TableCell className="text-right">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center justify-end gap-1">
                <span
                  className={cn(
                    'font-mono',
                    item.buyBoxIsYours
                      ? 'text-green-600'
                      : item.priceSource === 'buybox'
                        ? 'text-amber-600'
                        : item.priceSource === 'lowest'
                          ? 'text-purple-600'
                          : 'text-muted-foreground'
                  )}
                >
                  {formatCurrency(item.effectivePrice)}
                </span>
                {item.buyBoxIsYours && (
                  <span className="text-xs text-green-600">(yours)</span>
                )}
                {item.priceSource === 'lowest' && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] text-purple-600 border-purple-300">
                    <ArrowDown className="h-2.5 w-2.5 mr-0.5" />
                    Low
                  </Badge>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">
              <div className="text-xs space-y-1">
                {item.buyBoxPrice !== null && (
                  <p>Buy Box: {formatCurrency(item.buyBoxPrice)}</p>
                )}
                {item.lowestOfferPrice !== null && (
                  <p>Lowest: {formatCurrency(item.lowestOfferPrice)}</p>
                )}
                {item.priceSource === 'lowest' && (
                  <p className="text-purple-400">No buy box - showing lowest offer</p>
                )}
                {item.priceSource === 'none' && (
                  <p className="text-muted-foreground">No pricing data available</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Diff */}
      <TableCell className="text-right">
        <span
          className={cn(
            'font-mono text-xs',
            currentDiff !== null && currentDiff > 0
              ? 'text-red-600'
              : currentDiff !== null && currentDiff < 0
                ? 'text-green-600'
                : 'text-muted-foreground'
          )}
        >
          {formatDiff(currentDiff)}
        </span>
      </TableCell>

      {/* Was Price (90-day) */}
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <span className="font-mono text-muted-foreground">
            {formatCurrency(item.wasPrice)}
          </span>
          {getTrendIndicator()}
        </div>
      </TableCell>

      {/* Cost (toggleable) */}
      <TableCell className="text-right">
        {useManualCost ? (
          <div className="flex items-center justify-end gap-1">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={manualCost}
              onChange={(e) => setManualCost(e.target.value)}
              className="h-8 w-20 font-mono text-right"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleToggleCost}
              title="Use inventory cost"
            >
              <Package className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <span className="font-mono text-muted-foreground">
              {formatCurrency(item.inventoryCost)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleToggleCost}
              title="Enter manual cost"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}
      </TableCell>

      {/* Profit */}
      <TableCell className="text-right">
        <ProfitCalculator salePrice={effectivePrice} productCost={effectiveCost} />
      </TableCell>

      {/* Action */}
      <TableCell className="text-center">
        <PushPriceButton
          status={pushStatus}
          errorMessage={pushError}
          disabled={!priceChanged}
          onClick={handlePushPrice}
        />
      </TableCell>
    </TableRow>
  );
}
