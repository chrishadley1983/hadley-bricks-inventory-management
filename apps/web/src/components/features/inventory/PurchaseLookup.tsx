'use client';

import * as React from 'react';
import { Search, X, Loader2, Plus, Calendar, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePurchaseLookup, calculateSuggestedCost } from '@/hooks';
import type { PurchaseSearchResult } from '@/lib/api';

interface PurchaseLookupProps {
  value?: string;
  selectedPurchase?: PurchaseSearchResult | null;
  onSelect: (purchase: PurchaseSearchResult | null, suggestedCost: number | null) => void;
  onCreateNew?: (searchTerm: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Format a date string for display
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

/**
 * Purchase lookup combobox component
 * Provides searchable dropdown for linking inventory items to purchases
 */
export function PurchaseLookup({
  value,
  selectedPurchase,
  onSelect,
  onCreateNew,
  disabled = false,
  placeholder = 'Search purchases...',
  className,
}: PurchaseLookupProps) {
  const { searchTerm, setSearchTerm, results, isLoading, isOpen, setIsOpen } = usePurchaseLookup();

  const inputRef = React.useRef<HTMLInputElement>(null);

  // Display text for the selected purchase
  const displayValue = React.useMemo(() => {
    if (selectedPurchase) {
      return `${selectedPurchase.short_description} (${formatDate(selectedPurchase.purchase_date)})`;
    }
    return '';
  }, [selectedPurchase]);

  const handleSelect = React.useCallback(
    (purchase: PurchaseSearchResult) => {
      const suggestedCost = calculateSuggestedCost(purchase, 1);
      onSelect(purchase, suggestedCost);
      setSearchTerm('');
      setIsOpen(false);
    },
    [onSelect, setSearchTerm, setIsOpen]
  );

  const handleClear = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(null, null);
      setSearchTerm('');
    },
    [onSelect, setSearchTerm]
  );

  const handleCreateNew = React.useCallback(() => {
    if (onCreateNew) {
      onCreateNew(searchTerm);
      setIsOpen(false);
    }
  }, [onCreateNew, searchTerm, setIsOpen]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    },
    [setIsOpen]
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'relative flex items-center w-full',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            disabled={disabled}
            className={cn(
              'w-full justify-start text-left font-normal h-10',
              !selectedPurchase && 'text-muted-foreground',
              selectedPurchase && 'pr-8'
            )}
          >
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <span className="truncate flex-1">{displayValue || placeholder}</span>
          </Button>
        </PopoverTrigger>
        {selectedPurchase && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 p-0.5 hover:bg-accent rounded z-10"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4 opacity-50 hover:opacity-100" />
          </button>
        )}
      </div>
      <PopoverContent className="w-[400px] p-0" align="start" onKeyDown={handleKeyDown}>
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            ref={inputRef}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Type to search purchases..."
            className="h-10 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus
          />
          {isLoading && <Loader2 className="h-4 w-4 animate-spin opacity-50" />}
        </div>

        <ScrollArea className="max-h-[300px]">
          {searchTerm.length < 2 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </div>
          ) : results.length === 0 && !isLoading ? (
            <div className="py-6 text-center text-sm">
              <p className="text-muted-foreground mb-2">No purchases found</p>
              {onCreateNew && searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCreateNew}
                  className="text-primary"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Create &quot;{searchTerm}&quot;
                </Button>
              )}
            </div>
          ) : (
            <div className="p-1">
              {results.map((purchase) => (
                <button
                  key={purchase.id}
                  type="button"
                  onClick={() => handleSelect(purchase)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md hover:bg-accent cursor-pointer',
                    'focus:bg-accent focus:outline-none',
                    value === purchase.id && 'bg-accent'
                  )}
                >
                  <div className="font-medium truncate">{purchase.short_description}</div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(purchase.purchase_date)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Coins className="h-3 w-3" />
                      {formatCurrency(purchase.cost)}
                    </span>
                    {purchase.items_linked > 0 && (
                      <span className="text-orange-600">
                        {purchase.items_linked} item{purchase.items_linked > 1 ? 's' : ''} linked
                      </span>
                    )}
                  </div>
                  {purchase.source && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Source: {purchase.source}
                    </div>
                  )}
                </button>
              ))}

              {/* Create new option at bottom */}
              {onCreateNew && searchTerm.length >= 2 && (
                <button
                  type="button"
                  onClick={handleCreateNew}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md hover:bg-accent cursor-pointer',
                    'focus:bg-accent focus:outline-none border-t mt-1 pt-2'
                  )}
                >
                  <div className="flex items-center text-primary">
                    <Plus className="mr-2 h-4 w-4" />
                    <span>Create new purchase: &quot;{searchTerm}&quot;</span>
                  </div>
                </button>
              )}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
