'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, MapPin, Calendar, TrendingUp, ExternalLink } from 'lucide-react';

interface LinkedInventoryItem {
  id: string;
  set_number: string | null;
  item_name: string | null;
  condition: string | null;
  status: string | null;
  storage_location: string | null;
  cost: number | null;
  sold_price: number | null;
  sold_date: string | null;
  sold_gross_amount: number | null;
  sold_fees_amount: number | null;
  sold_net_amount: number | null;
  purchase_date: string | null;
}

interface LinkedInventoryPopoverProps {
  inventoryItemId: string;
  children: React.ReactNode;
}

async function fetchInventoryItem(id: string): Promise<LinkedInventoryItem | null> {
  const response = await fetch(`/api/inventory/${id}`);
  if (!response.ok) return null;
  const result = await response.json();
  return result.data;
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function calculateProfit(item: LinkedInventoryItem): {
  amount: number | null;
  percentage: number | null;
} {
  if (!item.cost || !item.sold_net_amount) {
    return { amount: null, percentage: null };
  }
  const profit = item.sold_net_amount - item.cost;
  const percentage = (profit / item.cost) * 100;
  return { amount: profit, percentage };
}

export function LinkedInventoryPopover({ inventoryItemId, children }: LinkedInventoryPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data: item, isLoading } = useQuery({
    queryKey: ['inventory', 'item', inventoryItemId],
    queryFn: () => fetchInventoryItem(inventoryItemId),
    enabled: isOpen,
    staleTime: 30000,
  });

  const profit = item ? calculateProfit(item) : { amount: null, percentage: null };

  return (
    <HoverCard openDelay={200} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-80" side="top" align="start">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </div>
        ) : item ? (
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-semibold">{item.set_number || 'N/A'}</span>
                  {item.condition && (
                    <Badge variant="outline" className="text-xs">
                      {item.condition}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {item.item_name || 'Unknown Item'}
                </p>
              </div>
              <Link
                href={`/inventory/${inventoryItemId}`}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                title="View inventory item"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>

            {/* Location */}
            {item.storage_location && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{item.storage_location}</span>
              </div>
            )}

            {/* Financial Summary */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div>
                <div className="text-xs text-muted-foreground">Cost</div>
                <div className="font-medium">{formatCurrency(item.cost)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Sale Price</div>
                <div className="font-medium">{formatCurrency(item.sold_price)}</div>
              </div>
            </div>

            {/* Fees & Net */}
            {item.sold_fees_amount !== null && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Fees</div>
                  <div className="font-medium text-red-600">
                    {formatCurrency(
                      item.sold_fees_amount ? -Math.abs(item.sold_fees_amount) : null
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Net</div>
                  <div className="font-medium">{formatCurrency(item.sold_net_amount)}</div>
                </div>
              </div>
            )}

            {/* Profit */}
            {profit.amount !== null && (
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-1.5">
                  <TrendingUp
                    className={`h-4 w-4 ${profit.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}
                  />
                  <span className="text-xs text-muted-foreground">Profit</span>
                </div>
                <div className="text-right">
                  <span
                    className={`font-semibold ${profit.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {formatCurrency(profit.amount)}
                  </span>
                  {profit.percentage !== null && (
                    <span
                      className={`text-xs ml-1 ${profit.percentage >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      ({profit.percentage >= 0 ? '+' : ''}
                      {profit.percentage.toFixed(0)}%)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Sale Date */}
            {item.sold_date && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <Calendar className="h-3 w-3" />
                <span>Sold {formatDate(item.sold_date)}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Unable to load inventory details</div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
