'use client';

import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Search, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ArbitrageFilterOptions, ArbitrageShowFilter, ArbitrageSortField } from '@/lib/arbitrage/types';
import { SHOW_FILTER_OPTIONS, SORT_OPTIONS } from '@/lib/arbitrage/types';

interface ArbitrageFiltersProps {
  filters: ArbitrageFilterOptions;
  onFiltersChange: (filters: ArbitrageFilterOptions) => void;
  totalItems: number;
  opportunities: number;
  unmappedCount: number;
  onOpenExcluded: () => void;
}

export function ArbitrageFilters({
  filters,
  onFiltersChange,
  totalItems,
  opportunities,
  unmappedCount,
  onOpenExcluded,
}: ArbitrageFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '');

  // Debounced search
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  }, 300);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      debouncedSearch(value);
    },
    [debouncedSearch]
  );

  const handleMinMarginChange = useCallback(
    (value: string) => {
      const margin = parseInt(value, 10);
      if (!isNaN(margin) && margin >= 0 && margin <= 100) {
        onFiltersChange({ ...filters, minMargin: margin });
      }
    },
    [filters, onFiltersChange]
  );

  const handleShowChange = useCallback(
    (value: ArbitrageShowFilter) => {
      onFiltersChange({ ...filters, show: value });
    },
    [filters, onFiltersChange]
  );

  const handleSortChange = useCallback(
    (value: ArbitrageSortField) => {
      onFiltersChange({ ...filters, sortField: value });
    },
    [filters, onFiltersChange]
  );

  const handleSortDirectionToggle = useCallback(() => {
    onFiltersChange({
      ...filters,
      sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc',
    });
  }, [filters, onFiltersChange]);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    onFiltersChange({ ...filters, search: undefined });
  }, [filters, onFiltersChange]);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
      {/* Min Margin */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Min Margin</label>
        <div className="flex items-center rounded-md border bg-background">
          <Input
            type="number"
            value={filters.minMargin ?? 30}
            onChange={(e) => handleMinMarginChange(e.target.value)}
            className="w-16 border-0 text-right font-mono focus-visible:ring-0"
            min={0}
            max={100}
          />
          <span className="px-2 text-sm text-muted-foreground">%</span>
        </div>
      </div>

      {/* Show Filter */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Show</label>
        <Select value={filters.show ?? 'all'} onValueChange={handleShowChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHOW_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Sort</label>
        <Select value={filters.sortField ?? 'margin'} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={handleSortDirectionToggle}
          title={`Sort ${filters.sortDirection === 'asc' ? 'ascending' : 'descending'}`}
        >
          {filters.sortDirection === 'asc' ? '↑' : '↓'}
        </Button>
      </div>

      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, ASIN, or set #..."
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 pr-8"
        />
        {searchInput && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
            onClick={clearSearch}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Excluded Button */}
      <Button variant="outline" onClick={onOpenExcluded}>
        <Filter className="mr-2 h-4 w-4" />
        Excluded
      </Button>

      {/* Stats Summary */}
      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Items</span>
          <Badge variant="secondary" className="font-mono">
            {totalItems}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Opportunities</span>
          <Badge variant="default" className="bg-green-600 font-mono">
            {opportunities}
          </Badge>
        </div>
        {unmappedCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Unmapped</span>
            <Badge variant="destructive" className="font-mono">
              {unmappedCount}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
