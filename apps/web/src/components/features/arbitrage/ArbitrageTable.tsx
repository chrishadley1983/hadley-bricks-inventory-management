'use client';

import { useState } from 'react';
import { ExternalLink, ShoppingCart } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ArbitrageItem } from '@/lib/arbitrage/types';
import {
  formatMarginPercent,
  formatCurrencyGBP,
  formatSalesRank,
  isOpportunity,
} from '@/lib/arbitrage/calculations';
import { AmazonOffersModal } from './AmazonOffersModal';

interface ArbitrageTableProps {
  items: ArbitrageItem[];
  isLoading: boolean;
  minMargin: number;
  onRowClick: (item: ArbitrageItem) => void;
}

export function ArbitrageTable({
  items,
  isLoading,
  minMargin,
  onRowClick,
}: ArbitrageTableProps) {
  const [offersModalItem, setOffersModalItem] = useState<ArbitrageItem | null>(null);

  if (isLoading) {
    return <ArbitrageTableSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-4xl mb-4">📊</div>
        <h3 className="text-lg font-semibold">No items found</h3>
        <p className="text-muted-foreground mt-1">
          Try adjusting your filters or syncing inventory data
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[22%]">Item</TableHead>
              <TableHead className="w-[10%]">Your Price</TableHead>
              <TableHead className="w-[10%]">Buy Box</TableHead>
              <TableHead className="w-[8%]">Offers</TableHead>
              <TableHead className="w-[10%]">Was Price</TableHead>
              <TableHead className="w-[8%]">Rank</TableHead>
              <TableHead className="w-[10%]">BL Min</TableHead>
              <TableHead className="w-[9%]">Margin</TableHead>
              <TableHead className="w-[6%]">BL Lots</TableHead>
              <TableHead className="w-[5%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <ArbitrageTableRow
                key={item.asin}
                item={item}
                minMargin={minMargin}
                onClick={() => onRowClick(item)}
                onOffersClick={() => setOffersModalItem(item)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Amazon Offers Modal */}
      <AmazonOffersModal
        item={offersModalItem}
        isOpen={offersModalItem !== null}
        onClose={() => setOffersModalItem(null)}
      />
    </>
  );
}

interface ArbitrageTableRowProps {
  item: ArbitrageItem;
  minMargin: number;
  onClick: () => void;
  onOffersClick: () => void;
}

function ArbitrageTableRow({ item, minMargin, onClick, onOffersClick }: ArbitrageTableRowProps) {
  const isOpp = isOpportunity(item.marginPercent, minMargin);

  // Determine effective price (buy box or lowest offer fallback)
  const hasBuyBox = item.buyBoxPrice !== null;
  const effectivePrice = item.effectiveAmazonPrice ?? item.buyBoxPrice ?? item.lowestOfferPrice;

  return (
    <TableRow
      className={cn(
        'cursor-pointer transition-colors',
        isOpp && 'bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50'
      )}
      onClick={onClick}
    >
      {/* Item */}
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-md border bg-muted flex items-center justify-center text-xl flex-shrink-0">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name ?? item.asin}
                className="h-full w-full object-contain rounded-md"
              />
            ) : (
              '📦'
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-semibold text-sm truncate max-w-[220px]">
                {item.name ?? 'Unknown Product'}
              </div>
              {item.itemType === 'seeded' && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5",
                          item.seededMatchConfidence && item.seededMatchConfidence >= 95
                            ? "bg-green-50 text-green-700 border-green-200"
                            : item.seededMatchConfidence && item.seededMatchConfidence >= 85
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        )}
                      >
                        Seeded
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Match: {item.seededMatchMethod ?? 'unknown'}
                        {item.seededMatchConfidence != null && ` (${item.seededMatchConfidence}%)`}
                      </p>
                      {item.bricksetTheme && (
                        <p className="text-xs text-muted-foreground">
                          {item.bricksetTheme} ({item.bricksetYear})
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs text-muted-foreground">
                {item.bricklinkSetNumber ?? '—'}
              </span>
              <Badge variant="outline" className="font-mono text-[10px] px-1.5">
                {item.asin}
              </Badge>
              {item.bricksetRrp != null && (
                <span className="text-xs text-muted-foreground">
                  RRP: {formatCurrencyGBP(item.bricksetRrp)}
                </span>
              )}
            </div>
          </div>
        </div>
      </TableCell>

      {/* Your Price */}
      <TableCell>
        <div className="font-mono font-semibold">
          {formatCurrencyGBP(item.yourPrice)}
        </div>
        <div className="text-xs text-muted-foreground">
          Qty: {item.yourQty ?? 0}
        </div>
      </TableCell>

      {/* Buy Box / Effective Price */}
      <TableCell>
        <div
          className={cn(
            'font-mono font-semibold',
            item.buyBoxIsYours
              ? 'text-green-600'
              : hasBuyBox
              ? 'text-amber-600'
              : effectivePrice
              ? 'text-muted-foreground'
              : ''
          )}
        >
          {formatCurrencyGBP(effectivePrice)}
        </div>
        <div
          className={cn(
            'text-xs',
            item.buyBoxIsYours ? 'text-green-600' : 'text-muted-foreground'
          )}
        >
          {item.buyBoxIsYours ? 'You (Buy Box)' : hasBuyBox ? 'Buy Box' : effectivePrice ? 'Lowest Offer' : '—'}
        </div>
      </TableCell>

      {/* Offers */}
      <TableCell>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2 font-mono"
                onClick={(e) => {
                  e.stopPropagation();
                  onOffersClick();
                }}
              >
                <ShoppingCart className="h-3 w-3 mr-1" />
                {item.totalOfferCount ?? item.offerCount ?? '—'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Click to view all offers</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Was Price */}
      <TableCell>
        <div className="font-mono text-muted-foreground">
          {formatCurrencyGBP(item.wasPrice90d)}
        </div>
        <div className="text-xs text-muted-foreground">90-day median</div>
      </TableCell>

      {/* Rank */}
      <TableCell>
        <div className="font-mono text-sm">{formatSalesRank(item.salesRank)}</div>
        <div className="text-xs text-muted-foreground">
          {item.salesRankCategory ?? '—'}
        </div>
      </TableCell>

      {/* BL Min */}
      <TableCell>
        <div className="font-mono font-semibold text-blue-600">
          {formatCurrencyGBP(item.blMinPrice)}
        </div>
        <div className="text-xs text-muted-foreground">
          Avg: {formatCurrencyGBP(item.blAvgPrice)}
        </div>
      </TableCell>

      {/* Margin */}
      <TableCell>
        <div
          className={cn(
            'font-mono font-bold',
            (item.marginPercent ?? 0) >= minMargin
              ? 'text-green-600'
              : (item.marginPercent ?? 0) < 0
              ? 'text-red-600'
              : 'text-muted-foreground'
          )}
        >
          {formatMarginPercent(item.marginPercent)}
        </div>
      </TableCell>

      {/* BL Lots */}
      <TableCell>
        <Badge variant="outline" className="font-mono bg-blue-50 text-blue-700">
          {item.blTotalLots ?? '—'}
        </Badge>
      </TableCell>

      {/* Action */}
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ArbitrageTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-[22%]">Item</TableHead>
            <TableHead className="w-[10%]">Your Price</TableHead>
            <TableHead className="w-[10%]">Buy Box</TableHead>
            <TableHead className="w-[8%]">Offers</TableHead>
            <TableHead className="w-[10%]">Was Price</TableHead>
            <TableHead className="w-[8%]">Rank</TableHead>
            <TableHead className="w-[10%]">BL Min</TableHead>
            <TableHead className="w-[9%]">Margin</TableHead>
            <TableHead className="w-[6%]">BL Lots</TableHead>
            <TableHead className="w-[5%]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-md" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[200px]" />
                    <Skeleton className="h-3 w-[120px]" />
                  </div>
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-6 w-10" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-14" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-14" /></TableCell>
              <TableCell><Skeleton className="h-6 w-10" /></TableCell>
              <TableCell><Skeleton className="h-8 w-8 rounded" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
