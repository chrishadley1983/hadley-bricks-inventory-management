'use client';

import { useState, useMemo } from 'react';
import { Search, Calendar, Package } from 'lucide-react';
import { usePurchaseList } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useDebouncedCallback } from 'use-debounce';

export interface LinkedPurchaseData {
  id: string;
  cost: number;
  source: string | null;
}

interface LinkPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (purchase: LinkedPurchaseData) => void;
  uploadDate?: string;
}

export function LinkPurchaseDialog({
  open,
  onOpenChange,
  onSelect,
  uploadDate,
}: LinkPurchaseDialogProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedSetSearch(value);
  };

  // Fetch recent purchases, prioritizing those near the upload date
  const { data: purchasesData, isLoading } = usePurchaseList(
    debouncedSearch ? { search: debouncedSearch } : undefined,
    { page: 1, pageSize: 50 }
  );

  // Sort purchases by proximity to upload date if available
  const sortedPurchases = useMemo(() => {
    if (!purchasesData?.data) return [];
    if (!uploadDate) return purchasesData.data;

    const uploadTime = new Date(uploadDate).getTime();
    return [...purchasesData.data].sort((a, b) => {
      const aDiff = Math.abs(new Date(a.purchase_date).getTime() - uploadTime);
      const bDiff = Math.abs(new Date(b.purchase_date).getTime() - uploadTime);
      return aDiff - bDiff;
    });
  }, [purchasesData?.data, uploadDate]);

  const handleSelect = (purchase: LinkedPurchaseData) => {
    onSelect(purchase);
    setSearch('');
    setDebouncedSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Link to Purchase</DialogTitle>
          <DialogDescription>
            Select a purchase to link this upload to. Purchases closest to the upload date are shown
            first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search purchases..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>

          <ScrollArea className="h-[300px] rounded-md border">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-pulse text-muted-foreground">Loading purchases...</div>
              </div>
            ) : sortedPurchases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Package className="h-8 w-8 mb-2" />
                <p>No purchases found</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {sortedPurchases.map((purchase) => {
                  // Calculate days difference from upload date
                  let daysDiff: number | null = null;
                  if (uploadDate) {
                    const uploadTime = new Date(uploadDate).getTime();
                    const purchaseTime = new Date(purchase.purchase_date).getTime();
                    daysDiff = Math.round((uploadTime - purchaseTime) / (1000 * 60 * 60 * 24));
                  }

                  return (
                    <Button
                      key={purchase.id}
                      variant="ghost"
                      className="w-full justify-start h-auto py-3 px-3"
                      onClick={() =>
                        handleSelect({
                          id: purchase.id,
                          cost: purchase.cost,
                          source: purchase.source,
                        })
                      }
                    >
                      <div className="flex flex-col items-start gap-1 text-left w-full">
                        <div className="flex items-center justify-between w-full">
                          <span className="font-medium truncate max-w-[280px]">
                            {purchase.short_description}
                          </span>
                          <span className="font-medium text-sm">
                            {formatCurrency(purchase.cost)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(purchase.purchase_date)}
                          </span>
                          {purchase.source && (
                            <Badge variant="outline" className="text-xs py-0">
                              {purchase.source}
                            </Badge>
                          )}
                          {daysDiff !== null && (
                            <span className="text-xs">
                              {daysDiff === 0
                                ? 'Same day'
                                : daysDiff > 0
                                  ? `${daysDiff}d after purchase`
                                  : `${Math.abs(daysDiff)}d before purchase`}
                            </span>
                          )}
                        </div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
