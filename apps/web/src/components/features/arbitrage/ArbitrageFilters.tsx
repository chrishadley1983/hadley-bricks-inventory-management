'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Search, SlidersHorizontal, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
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
import type {
  ArbitrageFilterOptions,
  ArbitrageShowFilter,
  ArbitrageSortField,
} from '@/lib/arbitrage/types';
import { SHOW_FILTER_OPTIONS, SORT_OPTIONS } from '@/lib/arbitrage/types';

interface ArbitrageFiltersProps {
  filters: ArbitrageFilterOptions;
  onFiltersChange: (filters: ArbitrageFilterOptions) => void;
  totalItems: number;
  opportunities: number;
  unmappedCount: number;
  onOpenExcluded: () => void;
  /** Override show filter options (for eBay page) */
  showFilterOptions?: { value: ArbitrageShowFilter; label: string }[];
  /** Override sort options (for eBay page) */
  sortOptions?: { value: ArbitrageSortField; label: string }[];
  /** Default sort field value */
  defaultSortField?: ArbitrageSortField;
  /** Count of seeded items in results */
  seededCount?: number;
  /** Count of inventory items in results */
  inventoryCount?: number;
  /** Whether there are more pages of results */
  hasMore?: boolean;
}

/** Numeric input that commits on blur or Enter — avoids per-keystroke API calls */
function DebouncedNumberInput({
  value,
  onChange,
  placeholder,
  className,
  step,
  min,
}: {
  value?: number;
  onChange: (val: number | undefined) => void;
  placeholder?: string;
  className?: string;
  step?: number;
  min?: number;
}) {
  const [local, setLocal] = useState(value?.toString() ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when external value changes (e.g., "Clear all" button)
  useEffect(() => {
    const isFocused = inputRef.current === document.activeElement;
    if (!isFocused) {
      setLocal(value?.toString() ?? '');
    }
  }, [value]);

  const commit = useCallback(() => {
    const parsed = local ? Number(local) : undefined;
    if (parsed !== value) onChange(parsed);
  }, [local, value, onChange]);

  return (
    <Input
      ref={inputRef}
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      placeholder={placeholder}
      className={className}
      step={step}
      min={min}
    />
  );
}

/** Range filter input pair — commits on blur/Enter to avoid per-keystroke API calls */
function RangeFilter({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  minPlaceholder = 'Min',
  maxPlaceholder = 'Max',
  step,
}: {
  label: string;
  minValue?: number;
  maxValue?: number;
  onMinChange: (val: number | undefined) => void;
  onMaxChange: (val: number | undefined) => void;
  minPlaceholder?: string;
  maxPlaceholder?: string;
  step?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1">
        <DebouncedNumberInput
          value={minValue}
          onChange={onMinChange}
          placeholder={minPlaceholder}
          className="w-20 h-8 text-xs font-mono"
          step={step}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <DebouncedNumberInput
          value={maxValue}
          onChange={onMaxChange}
          placeholder={maxPlaceholder}
          className="w-20 h-8 text-xs font-mono"
          step={step}
        />
      </div>
    </div>
  );
}

export function ArbitrageFilters({
  filters,
  onFiltersChange,
  totalItems,
  opportunities,
  unmappedCount,
  onOpenExcluded,
  showFilterOptions = SHOW_FILTER_OPTIONS,
  sortOptions = SORT_OPTIONS,
  defaultSortField = 'margin',
  seededCount,
  inventoryCount,
  hasMore,
}: ArbitrageFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Count active advanced filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.amazonPriceMin !== undefined) count++;
    if (filters.amazonPriceMax !== undefined) count++;
    if (filters.blPriceMin !== undefined) count++;
    if (filters.blPriceMax !== undefined) count++;
    if (filters.marginMin !== undefined) count++;
    if (filters.marginMax !== undefined) count++;
    if (filters.salesRankMin !== undefined) count++;
    if (filters.salesRankMax !== undefined) count++;
    if (filters.blLotsMin !== undefined) count++;
    if (filters.blLotsMax !== undefined) count++;
    if (filters.qtyMin !== undefined) count++;
    if (filters.qtyMax !== undefined) count++;
    if (filters.source && filters.source !== 'all') count++;
    if (filters.maxDataAgeDays !== undefined) count++;
    if (filters.minMargin && filters.minMargin > 0) count++;
    return count;
  }, [filters]);

  // Debounced search
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined, page: 1 });
  }, 300);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      debouncedSearch(value);
    },
    [debouncedSearch]
  );

  const handleShowChange = useCallback(
    (value: ArbitrageShowFilter) => {
      onFiltersChange({ ...filters, show: value, page: 1 });
    },
    [filters, onFiltersChange]
  );

  const handleSortChange = useCallback(
    (value: ArbitrageSortField) => {
      onFiltersChange({ ...filters, sortField: value, page: 1 });
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
    onFiltersChange({ ...filters, search: undefined, page: 1 });
  }, [filters, onFiltersChange]);

  const clearAllAdvanced = useCallback(() => {
    onFiltersChange({
      ...filters,
      minMargin: undefined,
      amazonPriceMin: undefined,
      amazonPriceMax: undefined,
      blPriceMin: undefined,
      blPriceMax: undefined,
      marginMin: undefined,
      marginMax: undefined,
      salesRankMin: undefined,
      salesRankMax: undefined,
      blLotsMin: undefined,
      blLotsMax: undefined,
      qtyMin: undefined,
      qtyMax: undefined,
      source: undefined,
      maxDataAgeDays: undefined,
      page: 1,
    });
  }, [filters, onFiltersChange]);

  // Helper to update a single advanced filter field
  const updateFilter = useCallback(
    (key: keyof ArbitrageFilterOptions, value: number | string | undefined) => {
      onFiltersChange({ ...filters, [key]: value, page: 1 });
    },
    [filters, onFiltersChange]
  );

  const currentPage = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const handlePreviousPage = useCallback(() => {
    if (currentPage > 1) {
      onFiltersChange({ ...filters, page: currentPage - 1 });
    }
  }, [filters, onFiltersChange, currentPage]);

  const handleNextPage = useCallback(() => {
    if (hasMore) {
      onFiltersChange({ ...filters, page: currentPage + 1 });
    }
  }, [filters, onFiltersChange, currentPage, hasMore]);

  return (
    <div className="space-y-0">
      {/* Primary filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        {/* Show Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Show</label>
          <Select value={filters.show ?? 'all'} onValueChange={handleShowChange}>
            <SelectTrigger className="w-[170px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {showFilterOptions.map((option) => (
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
          <Select value={filters.sortField ?? defaultSortField} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
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
            className="pl-9 pr-8 h-9"
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

        {/* Advanced Filters Toggle */}
        <Button
          variant={showAdvanced ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 justify-center text-[10px] rounded-full">
              {activeFilterCount}
            </Badge>
          )}
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>

        {/* Excluded Button */}
        <Button variant="outline" size="sm" className="h-9" onClick={onOpenExcluded}>
          Excluded
        </Button>

        {/* Pagination */}
        {totalItems > pageSize && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handlePreviousPage}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-mono px-2 text-muted-foreground">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handleNextPage}
              disabled={!hasMore}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Stats Summary */}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Items</span>
            <Badge variant="secondary" className="font-mono">
              {totalItems}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Opps</span>
            <Badge variant="default" className="bg-green-600 font-mono">
              {opportunities}
            </Badge>
          </div>
          {unmappedCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Unmapped</span>
              <Badge variant="destructive" className="font-mono">
                {unmappedCount}
              </Badge>
            </div>
          )}
          {seededCount !== undefined && seededCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Seeded</span>
              <Badge
                variant="outline"
                className="bg-purple-50 text-purple-700 border-purple-200 font-mono"
              >
                {seededCount}
              </Badge>
            </div>
          )}
          {inventoryCount !== undefined &&
            inventoryCount > 0 &&
            seededCount !== undefined &&
            seededCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">Inventory</span>
                <Badge
                  variant="outline"
                  className="bg-blue-50 text-blue-700 border-blue-200 font-mono"
                >
                  {inventoryCount}
                </Badge>
              </div>
            )}
        </div>
      </div>

      {/* Advanced Filters Panel (collapsible) */}
      {showAdvanced && (
        <div className="rounded-b-lg border border-t-0 bg-muted/30 p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Min Margin % (profit margin after Amazon fees + shipping) */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Min Margin %</label>
              <DebouncedNumberInput
                value={filters.minMargin}
                onChange={(v) => updateFilter('minMargin', v)}
                placeholder="0"
                className="w-20 h-8 text-xs font-mono"
                step={5}
              />
            </div>

            {/* Amazon Price */}
            <RangeFilter
              label="Amazon Price (£)"
              minValue={filters.amazonPriceMin}
              maxValue={filters.amazonPriceMax}
              onMinChange={(v) => updateFilter('amazonPriceMin', v)}
              onMaxChange={(v) => updateFilter('amazonPriceMax', v)}
              step={5}
            />

            {/* BL Price */}
            <RangeFilter
              label="BL Min Price (£)"
              minValue={filters.blPriceMin}
              maxValue={filters.blPriceMax}
              onMinChange={(v) => updateFilter('blPriceMin', v)}
              onMaxChange={(v) => updateFilter('blPriceMax', v)}
              step={5}
            />

            {/* Sales Rank */}
            <RangeFilter
              label="Sales Rank"
              minValue={filters.salesRankMin}
              maxValue={filters.salesRankMax}
              onMinChange={(v) => updateFilter('salesRankMin', v)}
              onMaxChange={(v) => updateFilter('salesRankMax', v)}
              step={1000}
            />

            {/* BL Lots */}
            <RangeFilter
              label="BL Lots"
              minValue={filters.blLotsMin}
              maxValue={filters.blLotsMax}
              onMinChange={(v) => updateFilter('blLotsMin', v)}
              onMaxChange={(v) => updateFilter('blLotsMax', v)}
            />

            {/* Qty */}
            <RangeFilter
              label="Qty"
              minValue={filters.qtyMin}
              maxValue={filters.qtyMax}
              onMinChange={(v) => updateFilter('qtyMin', v)}
              onMaxChange={(v) => updateFilter('qtyMax', v)}
            />

            {/* Source */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <Select
                value={filters.source ?? 'all'}
                onValueChange={(v: string) => updateFilter('source', v === 'all' ? undefined : v)}
              >
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="inventory">Inventory</SelectItem>
                  <SelectItem value="seeded">Seeded</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Data Freshness */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Max Age (days)</label>
              <DebouncedNumberInput
                value={filters.maxDataAgeDays}
                onChange={(v) => updateFilter('maxDataAgeDays', v)}
                placeholder="Any"
                className="w-20 h-8 text-xs font-mono"
                min={1}
              />
            </div>

            {/* Clear All */}
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={clearAllAdvanced}
              >
                <X className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
