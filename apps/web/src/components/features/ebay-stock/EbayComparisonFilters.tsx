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
import type { EbayComparisonFilters as EbayComparisonFiltersType } from '@/lib/platform-stock/ebay/types';

interface EbayComparisonFiltersProps {
  filters: EbayComparisonFiltersType;
  onFiltersChange: (filters: EbayComparisonFiltersType) => void;
}

export function EbayComparisonFilters({ filters, onFiltersChange }: EbayComparisonFiltersProps) {
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  }, 300);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[200px]">
        <Input
          placeholder="Search by SKU, title, or set number..."
          defaultValue={filters.search}
          onChange={(e) => debouncedSearch(e.target.value)}
        />
      </div>

      <Select
        value={filters.discrepancyType || 'all'}
        onValueChange={(value: string) =>
          onFiltersChange({
            ...filters,
            discrepancyType:
              value === 'all'
                ? undefined
                : (value as 'match' | 'platform_only' | 'inventory_only' | 'quantity_mismatch'),
          })
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Items</SelectItem>
          <SelectItem value="match">Matched</SelectItem>
          <SelectItem value="platform_only">eBay Only</SelectItem>
          <SelectItem value="inventory_only">Inventory Only</SelectItem>
          <SelectItem value="quantity_mismatch">Qty Mismatch</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Checkbox
          id="hideZeroQuantities"
          checked={filters.hideZeroQuantities || false}
          onCheckedChange={(checked: boolean | 'indeterminate') =>
            onFiltersChange({
              ...filters,
              hideZeroQuantities: checked === true ? true : undefined,
            })
          }
        />
        <Label htmlFor="hideZeroQuantities" className="text-sm cursor-pointer">
          Hide zero qty
        </Label>
      </div>
    </div>
  );
}
