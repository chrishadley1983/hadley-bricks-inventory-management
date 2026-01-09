'use client';

import { useState, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Search, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import type { PurchaseFilters as Filters } from '@/lib/api';

interface PurchaseFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

const SOURCES = [
  'eBay',
  'FB Marketplace',
  'BrickLink',
  'Amazon',
  'Car Boot',
  'Gumtree',
  'Retail',
  'Private',
  'Other',
];

const PAYMENT_METHODS = [
  'Cash',
  'Card',
  'PayPal',
  'Bank Transfer',
  'HSBC - Cash',
  'Monzo - Card',
];

export function PurchaseFilters({ filters, onFiltersChange }: PurchaseFiltersProps) {
  // Local state for search input to allow immediate UI feedback
  const [searchValue, setSearchValue] = useState(filters.search || '');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(
    filters.dateFrom ? new Date(filters.dateFrom) : undefined
  );
  const [dateTo, setDateTo] = useState<Date | undefined>(
    filters.dateTo ? new Date(filters.dateTo) : undefined
  );

  // Sync local state when filters.search changes externally (e.g., clear filters)
  useEffect(() => {
    setSearchValue(filters.search || '');
  }, [filters.search]);

  // Debounced callback to update filters after 300ms of no typing
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  }, 300);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value); // Update local state immediately
    debouncedSearch(value); // Debounce the actual filter update
  };

  const handleSourceChange = (value: string) => {
    onFiltersChange({
      ...filters,
      source: value === 'all' ? undefined : value,
    });
  };

  const handlePaymentMethodChange = (value: string) => {
    onFiltersChange({
      ...filters,
      paymentMethod: value === 'all' ? undefined : value,
    });
  };

  const handleDateFromChange = (date: Date | undefined) => {
    setDateFrom(date);
    onFiltersChange({
      ...filters,
      dateFrom: date ? format(date, 'yyyy-MM-dd') : undefined,
    });
  };

  const handleDateToChange = (date: Date | undefined) => {
    setDateTo(date);
    onFiltersChange({
      ...filters,
      dateTo: date ? format(date, 'yyyy-MM-dd') : undefined,
    });
  };

  const clearFilters = () => {
    setSearchValue('');
    setDateFrom(undefined);
    setDateTo(undefined);
    onFiltersChange({});
  };

  const hasActiveFilters =
    filters.search || filters.source || filters.paymentMethod || filters.dateFrom || filters.dateTo;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search purchases..."
            value={searchValue}
            onChange={handleSearchChange}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.source || 'all'} onValueChange={handleSourceChange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {SOURCES.map((source) => (
              <SelectItem key={source} value={source}>
                {source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.paymentMethod || 'all'} onValueChange={handlePaymentMethodChange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payments</SelectItem>
            {PAYMENT_METHODS.map((method) => (
              <SelectItem key={method} value={method}>
                {method}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
              <Filter className="mr-2 h-4 w-4" />
              {dateFrom ? format(dateFrom, 'dd/MM/yy') : 'From Date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom}
              onSelect={handleDateFromChange}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
              <Filter className="mr-2 h-4 w-4" />
              {dateTo ? format(dateTo, 'dd/MM/yy') : 'To Date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo}
              onSelect={handleDateToChange}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-2 h-4 w-4" />
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  );
}
