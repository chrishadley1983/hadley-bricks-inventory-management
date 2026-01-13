'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ExternalLink, Package, ShoppingCart, Filter } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { InventoryStockItem, InventoryStockSummary } from '@/app/api/brickset/inventory-stock/route';

interface SetStockModalProps {
  setNumber: string | null;
  setName: string | null;
  stock: InventoryStockSummary | null;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'current' | 'sold';
}

function formatCurrency(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value);
}

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const statusBadgeVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  'NOT YET RECEIVED': 'secondary',
  'BACKLOG': 'default',
  'LISTED': 'outline',
  'SOLD': 'destructive',
};

interface InventoryTableProps {
  items: InventoryStockItem[];
  showSoldColumns?: boolean;
}

function InventoryTable({ items, showSoldColumns }: InventoryTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">No items found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Set</th>
            <th className="px-3 py-2 text-left font-medium">Condition</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            {showSoldColumns ? (
              <>
                <th className="px-3 py-2 text-right font-medium">Sold Price</th>
                <th className="px-3 py-2 text-left font-medium">Sold Date</th>
                <th className="px-3 py-2 text-left font-medium">Platform</th>
              </>
            ) : (
              <>
                <th className="px-3 py-2 text-right font-medium">List Price</th>
                <th className="px-3 py-2 text-left font-medium">Platform</th>
                <th className="px-3 py-2 text-left font-medium">Location</th>
              </>
            )}
            <th className="px-3 py-2 text-center font-medium w-12">View</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={item.id}
              className={cn(
                'border-t hover:bg-muted/30',
                index === 0 ? 'bg-blue-50/30 dark:bg-blue-950/10' : ''
              )}
            >
              <td className="px-3 py-2">
                <div className="font-mono text-xs">{item.setNumber}</div>
                {item.itemName && (
                  <div className="text-xs text-muted-foreground truncate max-w-[150px]" title={item.itemName}>
                    {item.itemName}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge
                  variant={item.condition === 'New' ? 'default' : 'secondary'}
                  className="text-[10px]"
                >
                  {item.condition || '—'}
                </Badge>
              </td>
              <td className="px-3 py-2">
                <Badge
                  variant={statusBadgeVariant[item.status || ''] || 'outline'}
                  className="text-[10px]"
                >
                  {item.status || '—'}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs">
                {formatCurrency(item.cost)}
              </td>
              {showSoldColumns ? (
                <>
                  <td className="px-3 py-2 text-right font-mono text-xs text-green-600 font-medium">
                    {formatCurrency(item.soldPrice)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDate(item.soldDate)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {item.soldPlatform || '—'}
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 text-right font-mono text-xs text-blue-600 font-medium">
                    {formatCurrency(item.listingValue)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {item.listingPlatform || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[100px]" title={item.storageLocation || ''}>
                    {item.storageLocation || '—'}
                  </td>
                </>
              )}
              <td className="px-3 py-2 text-center">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                  <Link href={`/inventory?search=${item.setNumber}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SetStockModal({
  setNumber,
  setName,
  stock,
  isOpen,
  onClose,
  initialTab = 'current',
}: SetStockModalProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [conditionFilter, setConditionFilter] = useState<'all' | 'new' | 'used'>('all');

  // Filter items based on tab and condition
  const currentStockItems = useMemo(() => {
    if (!stock) return [];
    let items = stock.items.filter(
      (item) => item.status === 'BACKLOG' || item.status === 'LISTED'
    );
    if (conditionFilter === 'new') {
      items = items.filter((item) => item.condition === 'New');
    } else if (conditionFilter === 'used') {
      items = items.filter((item) => item.condition === 'Used');
    }
    return items;
  }, [stock, conditionFilter]);

  const soldStockItems = useMemo(() => {
    if (!stock) return [];
    let items = stock.items.filter((item) => item.status === 'SOLD');
    if (conditionFilter === 'new') {
      items = items.filter((item) => item.condition === 'New');
    } else if (conditionFilter === 'used') {
      items = items.filter((item) => item.condition === 'Used');
    }
    return items;
  }, [stock, conditionFilter]);

  // Calculate totals for display
  const currentTotal = currentStockItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  const soldTotal = soldStockItems.reduce((sum, item) => sum + (item.soldPrice || 0), 0);

  if (!setNumber) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-lg font-bold">
                Inventory: {setNumber}
              </DialogTitle>
              {setName && (
                <p className="text-sm text-muted-foreground mt-1">{setName}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="font-mono text-xs border-blue-300 text-blue-700">
                <Package className="h-3 w-3 mr-1" />
                {stock?.currentStock.total ?? 0} in stock
              </Badge>
              <Badge variant="outline" className="font-mono text-xs border-green-300 text-green-700">
                <ShoppingCart className="h-3 w-3 mr-1" />
                {stock?.soldStock.total ?? 0} sold
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Condition Filter */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Filter:</span>
          <div className="flex gap-1">
            <Button
              variant={conditionFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setConditionFilter('all')}
            >
              All
            </Button>
            <Button
              variant={conditionFilter === 'new' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setConditionFilter('new')}
            >
              New
            </Button>
            <Button
              variant={conditionFilter === 'used' ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setConditionFilter('used')}
            >
              Used
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'current' | 'sold')} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="current" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Current Stock ({currentStockItems.length})
            </TabsTrigger>
            <TabsTrigger value="sold" className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Sold ({soldStockItems.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="current" className="flex-1 min-h-0 mt-4">
            <ScrollArea className="h-[400px]">
              <InventoryTable items={currentStockItems} showSoldColumns={false} />
              {currentStockItems.length > 0 && (
                <div className="mt-3 text-sm text-muted-foreground text-right pr-4">
                  Total Cost: <span className="font-mono font-medium text-foreground">{formatCurrency(currentTotal)}</span>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="sold" className="flex-1 min-h-0 mt-4">
            <ScrollArea className="h-[400px]">
              <InventoryTable items={soldStockItems} showSoldColumns={true} />
              {soldStockItems.length > 0 && (
                <div className="mt-3 text-sm text-muted-foreground text-right pr-4">
                  Total Sold: <span className="font-mono font-medium text-green-600">{formatCurrency(soldTotal)}</span>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4 flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            Showing inventory items matching set {setNumber}
          </div>
          <Button asChild size="sm">
            <Link href={`/inventory?search=${setNumber.split('-')[0]}`}>
              View in Inventory
              <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
