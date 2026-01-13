'use client';

import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, X, RefreshCw, Clock } from 'lucide-react';
import type { RepricingFilters as FilterType } from '@/lib/repricing';

interface RepricingFiltersProps {
  filters: FilterType;
  onFiltersChange: (filters: FilterType) => void;
  onSyncPrices: () => void;
  isSyncing?: boolean;
  summary?: {
    totalListings: number;
    withCostData: number;
    buyBoxOwned: number;
    buyBoxLost: number;
    pricingDataAge?: string;
    isCached?: boolean;
  };
}

export function RepricingFilters({
  filters,
  onFiltersChange,
  onSyncPrices,
  isSyncing = false,
  summary,
}: RepricingFiltersProps) {
  const [searchValue, setSearchValue] = useState(filters.search || '');

  // Debounced search
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({
      ...filters,
      search: value || undefined,
    });
  }, 300);

  // Handle search input change
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchValue(value);
      debouncedSearch(value);
    },
    [debouncedSearch]
  );

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchValue('');
    onFiltersChange({
      ...filters,
      search: undefined,
    });
  }, [filters, onFiltersChange]);

  // Toggle checkbox filters
  const handleToggleWithCost = useCallback(
    (checked: boolean) => {
      onFiltersChange({
        ...filters,
        showOnlyWithCost: checked || undefined,
      });
    },
    [filters, onFiltersChange]
  );

  const handleToggleBuyBoxLost = useCallback(
    (checked: boolean) => {
      onFiltersChange({
        ...filters,
        showOnlyBuyBoxLost: checked || undefined,
      });
    },
    [filters, onFiltersChange]
  );

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
      {/* Search */}
      <div className="relative w-64">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search ASIN, SKU, title..."
          value={searchValue}
          onChange={handleSearchChange}
          className="pl-10 pr-8"
        />
        {searchValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
            onClick={handleClearSearch}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Filter checkboxes */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="showOnlyWithCost"
          checked={filters.showOnlyWithCost || false}
          onCheckedChange={handleToggleWithCost}
        />
        <Label htmlFor="showOnlyWithCost" className="text-sm cursor-pointer">
          With cost only
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="showOnlyBuyBoxLost"
          checked={filters.showOnlyBuyBoxLost || false}
          onCheckedChange={handleToggleBuyBoxLost}
        />
        <Label htmlFor="showOnlyBuyBoxLost" className="text-sm cursor-pointer">
          Buy Box lost
        </Label>
      </div>

      {/* Sync Prices button */}
      <Button
        variant="default"
        size="sm"
        onClick={onSyncPrices}
        disabled={isSyncing}
      >
        <RefreshCw
          className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
        />
        {isSyncing ? 'Syncing...' : 'Sync Prices'}
      </Button>

      {/* Cache age indicator */}
      {summary?.pricingDataAge && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>{summary.pricingDataAge}</span>
          {summary.isCached && (
            <Badge variant="secondary" className="ml-1 text-xs">
              cached
            </Badge>
          )}
        </div>
      )}

      {/* Summary stats */}
      {summary && (
        <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{summary.totalListings}</span>{' '}
            listings
          </span>
          <span>
            <span className="font-medium text-foreground">{summary.withCostData}</span>{' '}
            with cost
          </span>
          <span className="text-green-600">
            <span className="font-medium">{summary.buyBoxOwned}</span> Buy Box
          </span>
          <span className="text-amber-600">
            <span className="font-medium">{summary.buyBoxLost}</span> lost
          </span>
        </div>
      )}
    </div>
  );
}
