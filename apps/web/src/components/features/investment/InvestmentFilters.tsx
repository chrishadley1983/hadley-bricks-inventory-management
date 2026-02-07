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
import type { InvestmentFilters as Filters } from '@/lib/api/investment';

interface InvestmentFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

const RETIREMENT_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'available', label: 'Available' },
  { value: 'retiring_soon', label: 'Retiring Soon' },
  { value: 'retired', label: 'Retired' },
];

const RETIRING_WITHIN_OPTIONS = [
  { value: 'all', label: 'Any Timeframe' },
  { value: '3', label: 'Within 3 months' },
  { value: '6', label: 'Within 6 months' },
  { value: '12', label: 'Within 12 months' },
];

export function InvestmentFilters({ filters, onFiltersChange }: InvestmentFiltersProps) {
  const hasActiveFilters = !!(filters.search || filters.retirementStatus || filters.theme || filters.minYear || filters.maxYear || filters.retiringWithinMonths);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by set number or name..."
            value={searchValue}
            onChange={handleSearchChange}
            className="pl-10"
          />
        </div>

        <Select
          value={filters.retirementStatus || 'all'}
          onValueChange={(value: string) =>
            onFiltersChange({
              ...filters,
              retirementStatus: value === 'all' ? undefined : value as Filters['retirementStatus'],
            })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Retirement Status" />
          </SelectTrigger>
          <SelectContent>
            {RETIREMENT_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.retiringWithinMonths ? String(filters.retiringWithinMonths) : 'all'}
          onValueChange={(value: string) =>
            onFiltersChange({
              ...filters,
              retiringWithinMonths: value === 'all' ? undefined : Number(value),
            })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Retiring Within" />
          </SelectTrigger>
          <SelectContent>
            {RETIRING_WITHIN_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" onClick={clearFilters} size="sm">
            <X className="mr-2 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Input
          type="text"
          placeholder="Theme (e.g. Star Wars)"
          value={filters.theme || ''}
          onChange={(e) =>
            onFiltersChange({ ...filters, theme: e.target.value || undefined })
          }
          className="w-[200px]"
        />

        <Input
          type="number"
          placeholder="Min Year"
          value={filters.minYear || ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              minYear: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          className="w-[120px]"
        />

        <Input
          type="number"
          placeholder="Max Year"
          value={filters.maxYear || ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              maxYear: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          className="w-[120px]"
        />
      </div>
    </div>
  );
}
