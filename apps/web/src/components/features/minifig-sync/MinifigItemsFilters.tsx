'use client';

import { useState, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import type { MinifigSyncFilters } from '@/lib/api/minifig-sync';

interface MinifigItemsFiltersProps {
  filters: MinifigSyncFilters;
  onFiltersChange: (filters: MinifigSyncFilters) => void;
}

const THRESHOLD_OPTIONS = [
  { value: 'all', label: 'All Items' },
  { value: 'true', label: 'Meets Threshold' },
  { value: 'false', label: 'Below Threshold' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'NOT_LISTED', label: 'Not Listed' },
  { value: 'STAGED', label: 'Staged' },
  { value: 'PUBLISHING', label: 'Publishing' },
  { value: 'REVIEWING', label: 'Reviewing' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'SOLD_EBAY', label: 'Sold (eBay)' },
  { value: 'SOLD_EBAY_PENDING_REMOVAL', label: 'Sold eBay (Pending Removal)' },
  { value: 'SOLD_BRICQER', label: 'Sold (Bricqer)' },
  { value: 'SOLD_BRICQER_PENDING_REMOVAL', label: 'Sold Bricqer (Pending Removal)' },
  { value: 'ENDED', label: 'Ended' },
];

export function MinifigItemsFilters({ filters, onFiltersChange }: MinifigItemsFiltersProps) {
  const hasActiveFilters = filters.search || filters.meetsThreshold !== undefined || filters.listingStatus;

  const [searchValue, setSearchValue] = useState(filters.search || '');

  useEffect(() => {
    setSearchValue(filters.search || '');
  }, [filters.search]);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  }, 300);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    debouncedSearch(value);
  };

  const clearFilters = () => {
    setSearchValue('');
    onFiltersChange({});
  };

  const thresholdValue = filters.meetsThreshold === true
    ? 'true'
    : filters.meetsThreshold === false
      ? 'false'
      : 'all';

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or BrickLink ID..."
          value={searchValue}
          onChange={handleSearchChange}
          className="pl-9"
        />
      </div>

      <div className="flex gap-2">
        <Select
          value={thresholdValue}
          onValueChange={(value: string) =>
            onFiltersChange({
              ...filters,
              meetsThreshold: value === 'all' ? undefined : value === 'true',
            })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Threshold" />
          </SelectTrigger>
          <SelectContent>
            {THRESHOLD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.listingStatus || 'all'}
          onValueChange={(value: string) =>
            onFiltersChange({
              ...filters,
              listingStatus: value === 'all' ? undefined : value as MinifigSyncFilters['listingStatus'],
            })
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="icon" onClick={clearFilters}>
            <X className="h-4 w-4" />
            <span className="sr-only">Clear filters</span>
          </Button>
        )}
      </div>
    </div>
  );
}
