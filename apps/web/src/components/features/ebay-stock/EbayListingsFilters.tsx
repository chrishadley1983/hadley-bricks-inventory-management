'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useDebouncedCallback } from 'use-debounce';
import type { EbayListingFilters } from '@/lib/platform-stock/ebay/types';

interface EbayListingsFiltersProps {
  filters: EbayListingFilters;
  onFiltersChange: (filters: EbayListingFilters) => void;
}

export function EbayListingsFilters({
  filters,
  onFiltersChange,
}: EbayListingsFiltersProps) {
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  }, 300);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[200px]">
        <Input
          placeholder="Search by SKU, Item ID, or title..."
          defaultValue={filters.search}
          onChange={(e) => debouncedSearch(e.target.value)}
        />
      </div>

      <Select
        value={filters.listingStatus || 'all'}
        onValueChange={(value: string) =>
          onFiltersChange({
            ...filters,
            listingStatus: value === 'all' ? undefined : (value as 'Active' | 'Inactive'),
          })
        }
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="Active">Active</SelectItem>
          <SelectItem value="Inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Checkbox
          id="hasQuantity"
          checked={filters.hasQuantity || false}
          onCheckedChange={(checked: boolean | 'indeterminate') =>
            onFiltersChange({
              ...filters,
              hasQuantity: checked === true ? true : undefined,
            })
          }
        />
        <Label htmlFor="hasQuantity" className="text-sm cursor-pointer">
          In stock only
        </Label>
      </div>
    </div>
  );
}
