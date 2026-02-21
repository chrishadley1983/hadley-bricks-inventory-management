'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import type { ListingFilters, ListingStatus } from '@/lib/platform-stock';

interface ListingsFiltersProps {
  filters: ListingFilters;
  onFiltersChange: (filters: ListingFilters) => void;
}

const statusOptions: { value: ListingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
  { value: 'Incomplete', label: 'Incomplete' },
  { value: 'Out of Stock', label: 'Out of Stock' },
];

const fulfillmentOptions: { value: string; label: string }[] = [
  { value: 'all', label: 'All Fulfillment' },
  { value: 'FBA', label: 'FBA (Amazon)' },
  { value: 'FBM', label: 'FBM (Merchant)' },
];

export function ListingsFilters({ filters, onFiltersChange }: ListingsFiltersProps) {
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  }, 300);

  const handleStatusChange = (value: string) => {
    onFiltersChange({
      ...filters,
      listingStatus: value === 'all' ? undefined : (value as ListingStatus),
    });
  };

  const handleFulfillmentChange = (value: string) => {
    onFiltersChange({
      ...filters,
      fulfillmentChannel: value === 'all' ? undefined : value,
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  const hasActiveFilters =
    filters.search || filters.listingStatus || filters.fulfillmentChannel || filters.hasQuantity;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex-1 max-w-sm">
        <Input
          placeholder="Search by title, SKU, or ASIN..."
          defaultValue={filters.search || ''}
          onChange={(e) => debouncedSearch(e.target.value)}
        />
      </div>

      <Select value={filters.listingStatus || 'all'} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.fulfillmentChannel || 'all'} onValueChange={handleFulfillmentChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Fulfillment" />
        </SelectTrigger>
        <SelectContent>
          {fulfillmentOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="mr-1 h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  );
}
