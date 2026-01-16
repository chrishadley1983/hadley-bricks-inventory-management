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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import type { ComparisonFilters, DiscrepancyType } from '@/lib/platform-stock';

interface ComparisonFiltersProps {
  filters: ComparisonFilters;
  onFiltersChange: (filters: ComparisonFilters) => void;
}

const discrepancyOptions: { value: DiscrepancyType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Items' },
  { value: 'missing_asin', label: 'Missing ASIN' },
  { value: 'platform_only', label: 'Platform Only' },
  { value: 'inventory_only', label: 'Inventory Only' },
  { value: 'quantity_mismatch', label: 'Quantity Mismatch' },
  { value: 'match', label: 'Matched' },
];

export function ComparisonFiltersComponent({
  filters,
  onFiltersChange,
}: ComparisonFiltersProps) {
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  }, 300);

  const handleDiscrepancyChange = (value: string) => {
    onFiltersChange({
      ...filters,
      discrepancyType: value === 'all' ? undefined : (value as DiscrepancyType),
    });
  };

  const handleHideZerosChange = (checked: boolean) => {
    onFiltersChange({
      ...filters,
      hideZeroQuantities: checked || undefined,
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  const hasActiveFilters =
    filters.search || filters.discrepancyType || filters.hideZeroQuantities;

  // Only show the hide zeros toggle when filtering by 'match'
  const showHideZerosToggle = filters.discrepancyType === 'match';

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:flex-wrap">
      <div className="flex-1 max-w-sm">
        <Input
          placeholder="Search by ASIN, title, or set number..."
          defaultValue={filters.search || ''}
          onChange={(e) => debouncedSearch(e.target.value)}
        />
      </div>

      <Select
        value={filters.discrepancyType || 'all'}
        onValueChange={handleDiscrepancyChange}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          {discrepancyOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showHideZerosToggle && (
        <div className="flex items-center space-x-2">
          <Switch
            id="hide-zeros"
            checked={filters.hideZeroQuantities || false}
            onCheckedChange={handleHideZerosChange}
          />
          <Label htmlFor="hide-zeros" className="text-sm cursor-pointer">
            Hide 0/0 items
          </Label>
        </div>
      )}

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="mr-1 h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  );
}
