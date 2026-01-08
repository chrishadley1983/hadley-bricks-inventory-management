'use client';

import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/charts';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import type { BrickLinkUploadFilters as Filters } from '@/lib/api/bricklink-uploads';
import type { DateRangePreset } from '@/lib/services';

interface BrickLinkUploadFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

const SOURCES = [
  'Auction',
  'FB Marketplace',
  'FB Group',
  'Car Boot',
  'eBay',
  'Vinted',
  'Various',
  'Lego.com',
  'BL',
  'NA',
  'Other',
];

export function BrickLinkUploadFilters({ filters, onFiltersChange }: BrickLinkUploadFiltersProps) {
  const [search, setSearch] = useState(filters.search || '');
  const [preset, setPreset] = useState<DateRangePreset>('this_month');

  // Initialize with this month's dates if no filters set
  useEffect(() => {
    if (!filters.dateFrom && !filters.dateTo) {
      const start = startOfMonth(new Date());
      const end = endOfMonth(new Date());
      onFiltersChange({
        ...filters,
        dateFrom: format(start, 'yyyy-MM-dd'),
        dateTo: format(end, 'yyyy-MM-dd'),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onFiltersChange({ ...filters, search: search || undefined });
  };

  const handleSourceChange = (value: string) => {
    onFiltersChange({
      ...filters,
      source: value === 'all' ? undefined : value,
    });
  };

  const handleDateChange = (start: Date, end: Date, newPreset?: DateRangePreset) => {
    if (newPreset) {
      setPreset(newPreset);
    }
    onFiltersChange({
      ...filters,
      dateFrom: format(start, 'yyyy-MM-dd'),
      dateTo: format(end, 'yyyy-MM-dd'),
    });
  };

  const clearFilters = () => {
    setSearch('');
    const start = startOfMonth(new Date());
    const end = endOfMonth(new Date());
    setPreset('this_month');
    onFiltersChange({
      dateFrom: format(start, 'yyyy-MM-dd'),
      dateTo: format(end, 'yyyy-MM-dd'),
    });
  };

  const hasActiveFilters = filters.search || filters.source;

  // Parse dates for the picker
  const startDate = filters.dateFrom ? new Date(filters.dateFrom) : startOfMonth(new Date());
  const endDate = filters.dateTo ? new Date(filters.dateTo) : endOfMonth(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          preset={preset}
          onDateChange={handleDateChange}
          showPresets={true}
        />

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

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-2 h-4 w-4" />
            Clear Filters
          </Button>
        )}
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
    </div>
  );
}
