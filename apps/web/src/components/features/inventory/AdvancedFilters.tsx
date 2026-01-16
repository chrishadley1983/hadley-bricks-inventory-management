'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Filter, X, ChevronDown, CalendarIcon } from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import type { InventoryFilters as Filters, EmptyFilter } from '@/lib/api';

interface AdvancedFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

interface DateRangePickerProps {
  label: string;
  fromDate?: string;
  toDate?: string;
  onFromChange: (date: string | undefined) => void;
  onToChange: (date: string | undefined) => void;
}

function DateRangePicker({ label, fromDate, toDate, onFromChange, onToChange }: DateRangePickerProps) {
  const [from, setFrom] = useState<Date | undefined>(fromDate ? new Date(fromDate) : undefined);
  const [to, setTo] = useState<Date | undefined>(toDate ? new Date(toDate) : undefined);

  useEffect(() => {
    setFrom(fromDate ? new Date(fromDate) : undefined);
  }, [fromDate]);

  useEffect(() => {
    setTo(toDate ? new Date(toDate) : undefined);
  }, [toDate]);

  const handleFromChange = (date: Date | undefined) => {
    setFrom(date);
    onFromChange(date ? format(date, 'yyyy-MM-dd') : undefined);
  };

  const handleToChange = (date: Date | undefined) => {
    setTo(date);
    onToChange(date ? format(date, 'yyyy-MM-dd') : undefined);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`h-7 w-[90px] justify-start text-left font-normal text-xs px-2 ${!from ? 'text-muted-foreground' : ''}`}
          >
            <CalendarIcon className="mr-1 h-3 w-3" />
            {from ? format(from, 'dd/MM/yy') : 'From'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={from} onSelect={handleFromChange} />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`h-7 w-[90px] justify-start text-left font-normal text-xs px-2 ${!to ? 'text-muted-foreground' : ''}`}
          >
            <CalendarIcon className="mr-1 h-3 w-3" />
            {to ? format(to, 'dd/MM/yy') : 'To'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={to} onSelect={handleToChange} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface NumericRangeInputProps {
  label: string;
  min?: number;
  max?: number;
  onMinChange: (value: number | undefined) => void;
  onMaxChange: (value: number | undefined) => void;
}

function NumericRangeInput({ label, min, max, onMinChange, onMaxChange }: NumericRangeInputProps) {
  const [minValue, setMinValue] = useState(min?.toString() ?? '');
  const [maxValue, setMaxValue] = useState(max?.toString() ?? '');

  useEffect(() => {
    setMinValue(min?.toString() ?? '');
  }, [min]);

  useEffect(() => {
    setMaxValue(max?.toString() ?? '');
  }, [max]);

  const handleMinBlur = () => {
    const num = parseFloat(minValue);
    onMinChange(isNaN(num) ? undefined : num);
  };

  const handleMaxBlur = () => {
    const num = parseFloat(maxValue);
    onMaxChange(isNaN(num) ? undefined : num);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="relative">
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">£</span>
        <Input
          type="number"
          placeholder="Min"
          value={minValue}
          onChange={(e) => setMinValue(e.target.value)}
          onBlur={handleMinBlur}
          className="h-7 w-[70px] pl-4 text-xs"
        />
      </div>
      <span className="text-muted-foreground text-xs">-</span>
      <div className="relative">
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">£</span>
        <Input
          type="number"
          placeholder="Max"
          value={maxValue}
          onChange={(e) => setMaxValue(e.target.value)}
          onBlur={handleMaxBlur}
          className="h-7 w-[70px] pl-4 text-xs"
        />
      </div>
    </div>
  );
}

interface EmptyFilterSelectProps {
  label: string;
  value?: EmptyFilter;
  onChange: (value: EmptyFilter | undefined) => void;
}

function EmptyFilterSelect({ label, value, onChange }: EmptyFilterSelectProps) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <Select
        value={value || 'all'}
        onValueChange={(v: string) => onChange(v === 'all' ? undefined : v as EmptyFilter)}
      >
        <SelectTrigger className="h-7 w-[90px] text-xs">
          <SelectValue placeholder="Any" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any</SelectItem>
          <SelectItem value="not_empty">Has value</SelectItem>
          <SelectItem value="empty">Empty</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function AdvancedFilters({ filters, onFiltersChange }: AdvancedFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const advancedFilterCount = [
    filters.costRange?.min !== undefined || filters.costRange?.max !== undefined,
    filters.listingValueRange?.min !== undefined || filters.listingValueRange?.max !== undefined,
    filters.soldGrossRange?.min !== undefined || filters.soldGrossRange?.max !== undefined,
    filters.soldNetRange?.min !== undefined || filters.soldNetRange?.max !== undefined,
    filters.profitRange?.min !== undefined || filters.profitRange?.max !== undefined,
    filters.soldFeesRange?.min !== undefined || filters.soldFeesRange?.max !== undefined,
    filters.soldPostageRange?.min !== undefined || filters.soldPostageRange?.max !== undefined,
    filters.purchaseDateRange?.from || filters.purchaseDateRange?.to,
    filters.listingDateRange?.from || filters.listingDateRange?.to,
    filters.soldDateRange?.from || filters.soldDateRange?.to,
    filters.salePlatform,
    filters.source,
    filters.storageLocationFilter,
    filters.amazonAsinFilter,
    filters.linkedLotFilter,
    filters.linkedOrderFilter,
    filters.notesFilter,
    filters.skuFilter,
    filters.ebayListingFilter,
    filters.archiveLocationFilter,
  ].filter(Boolean).length;

  const clearAdvancedFilters = () => {
    onFiltersChange({
      status: filters.status,
      condition: filters.condition,
      platform: filters.platform,
      search: filters.search,
      purchaseId: filters.purchaseId,
    });
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <Filter className="mr-2 h-3.5 w-3.5" />
            Advanced
            {advancedFilterCount > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                {advancedFilterCount}
              </Badge>
            )}
            <ChevronDown className={`ml-2 h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        {advancedFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8" onClick={clearAdvancedFilters}>
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      <CollapsibleContent className="mt-3">
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          {/* Money Row */}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <NumericRangeInput
              label="Cost"
              min={filters.costRange?.min}
              max={filters.costRange?.max}
              onMinChange={(min) =>
                onFiltersChange({
                  ...filters,
                  costRange: min !== undefined || filters.costRange?.max !== undefined
                    ? { ...filters.costRange, min }
                    : undefined,
                })
              }
              onMaxChange={(max) =>
                onFiltersChange({
                  ...filters,
                  costRange: max !== undefined || filters.costRange?.min !== undefined
                    ? { ...filters.costRange, max }
                    : undefined,
                })
              }
            />
            <NumericRangeInput
              label="List Value"
              min={filters.listingValueRange?.min}
              max={filters.listingValueRange?.max}
              onMinChange={(min) =>
                onFiltersChange({
                  ...filters,
                  listingValueRange: min !== undefined || filters.listingValueRange?.max !== undefined
                    ? { ...filters.listingValueRange, min }
                    : undefined,
                })
              }
              onMaxChange={(max) =>
                onFiltersChange({
                  ...filters,
                  listingValueRange: max !== undefined || filters.listingValueRange?.min !== undefined
                    ? { ...filters.listingValueRange, max }
                    : undefined,
                })
              }
            />
            <NumericRangeInput
              label="Gross"
              min={filters.soldGrossRange?.min}
              max={filters.soldGrossRange?.max}
              onMinChange={(min) =>
                onFiltersChange({
                  ...filters,
                  soldGrossRange: min !== undefined || filters.soldGrossRange?.max !== undefined
                    ? { ...filters.soldGrossRange, min }
                    : undefined,
                })
              }
              onMaxChange={(max) =>
                onFiltersChange({
                  ...filters,
                  soldGrossRange: max !== undefined || filters.soldGrossRange?.min !== undefined
                    ? { ...filters.soldGrossRange, max }
                    : undefined,
                })
              }
            />
            <NumericRangeInput
              label="Net"
              min={filters.soldNetRange?.min}
              max={filters.soldNetRange?.max}
              onMinChange={(min) =>
                onFiltersChange({
                  ...filters,
                  soldNetRange: min !== undefined || filters.soldNetRange?.max !== undefined
                    ? { ...filters.soldNetRange, min }
                    : undefined,
                })
              }
              onMaxChange={(max) =>
                onFiltersChange({
                  ...filters,
                  soldNetRange: max !== undefined || filters.soldNetRange?.min !== undefined
                    ? { ...filters.soldNetRange, max }
                    : undefined,
                })
              }
            />
            <NumericRangeInput
              label="Profit"
              min={filters.profitRange?.min}
              max={filters.profitRange?.max}
              onMinChange={(min) =>
                onFiltersChange({
                  ...filters,
                  profitRange: min !== undefined || filters.profitRange?.max !== undefined
                    ? { ...filters.profitRange, min }
                    : undefined,
                })
              }
              onMaxChange={(max) =>
                onFiltersChange({
                  ...filters,
                  profitRange: max !== undefined || filters.profitRange?.min !== undefined
                    ? { ...filters.profitRange, max }
                    : undefined,
                })
              }
            />
            <NumericRangeInput
              label="Fees"
              min={filters.soldFeesRange?.min}
              max={filters.soldFeesRange?.max}
              onMinChange={(min) =>
                onFiltersChange({
                  ...filters,
                  soldFeesRange: min !== undefined || filters.soldFeesRange?.max !== undefined
                    ? { ...filters.soldFeesRange, min }
                    : undefined,
                })
              }
              onMaxChange={(max) =>
                onFiltersChange({
                  ...filters,
                  soldFeesRange: max !== undefined || filters.soldFeesRange?.min !== undefined
                    ? { ...filters.soldFeesRange, max }
                    : undefined,
                })
              }
            />
            <NumericRangeInput
              label="Postage"
              min={filters.soldPostageRange?.min}
              max={filters.soldPostageRange?.max}
              onMinChange={(min) =>
                onFiltersChange({
                  ...filters,
                  soldPostageRange: min !== undefined || filters.soldPostageRange?.max !== undefined
                    ? { ...filters.soldPostageRange, min }
                    : undefined,
                })
              }
              onMaxChange={(max) =>
                onFiltersChange({
                  ...filters,
                  soldPostageRange: max !== undefined || filters.soldPostageRange?.min !== undefined
                    ? { ...filters.soldPostageRange, max }
                    : undefined,
                })
              }
            />
          </div>

          {/* Dates & Platform Row */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
            <DateRangePicker
              label="Purchased"
              fromDate={filters.purchaseDateRange?.from}
              toDate={filters.purchaseDateRange?.to}
              onFromChange={(from) =>
                onFiltersChange({
                  ...filters,
                  purchaseDateRange: from || filters.purchaseDateRange?.to
                    ? { ...filters.purchaseDateRange, from }
                    : undefined,
                })
              }
              onToChange={(to) =>
                onFiltersChange({
                  ...filters,
                  purchaseDateRange: to || filters.purchaseDateRange?.from
                    ? { ...filters.purchaseDateRange, to }
                    : undefined,
                })
              }
            />
            <DateRangePicker
              label="Listed"
              fromDate={filters.listingDateRange?.from}
              toDate={filters.listingDateRange?.to}
              onFromChange={(from) =>
                onFiltersChange({
                  ...filters,
                  listingDateRange: from || filters.listingDateRange?.to
                    ? { ...filters.listingDateRange, from }
                    : undefined,
                })
              }
              onToChange={(to) =>
                onFiltersChange({
                  ...filters,
                  listingDateRange: to || filters.listingDateRange?.from
                    ? { ...filters.listingDateRange, to }
                    : undefined,
                })
              }
            />
            <DateRangePicker
              label="Sold"
              fromDate={filters.soldDateRange?.from}
              toDate={filters.soldDateRange?.to}
              onFromChange={(from) =>
                onFiltersChange({
                  ...filters,
                  soldDateRange: from || filters.soldDateRange?.to
                    ? { ...filters.soldDateRange, from }
                    : undefined,
                })
              }
              onToChange={(to) =>
                onFiltersChange({
                  ...filters,
                  soldDateRange: to || filters.soldDateRange?.from
                    ? { ...filters.soldDateRange, to }
                    : undefined,
                })
              }
            />
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Sold On</span>
              <Select
                value={filters.salePlatform || 'all'}
                onValueChange={(v: string) => onFiltersChange({ ...filters, salePlatform: v === 'all' ? undefined : v })}
              >
                <SelectTrigger className="h-7 w-[100px] text-xs">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any</SelectItem>
                  <SelectItem value="Amazon">Amazon</SelectItem>
                  <SelectItem value="eBay">eBay</SelectItem>
                  <SelectItem value="BrickLink">BrickLink</SelectItem>
                  <SelectItem value="Brick Owl">Brick Owl</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Source</span>
              <Select
                value={filters.source || 'all'}
                onValueChange={(v: string) => onFiltersChange({ ...filters, source: v === 'all' ? undefined : v })}
              >
                <SelectTrigger className="h-7 w-[110px] text-xs">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any</SelectItem>
                  <SelectItem value="eBay">eBay</SelectItem>
                  <SelectItem value="FB Marketplace">FB Marketplace</SelectItem>
                  <SelectItem value="BrickLink">BrickLink</SelectItem>
                  <SelectItem value="Amazon">Amazon</SelectItem>
                  <SelectItem value="Car Boot">Car Boot</SelectItem>
                  <SelectItem value="Gumtree">Gumtree</SelectItem>
                  <SelectItem value="Retail">Retail</SelectItem>
                  <SelectItem value="Private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Field Presence Row */}
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            <EmptyFilterSelect
              label="Linked Order"
              value={filters.linkedOrderFilter}
              onChange={(value) => onFiltersChange({ ...filters, linkedOrderFilter: value })}
            />
            <EmptyFilterSelect
              label="Storage"
              value={filters.storageLocationFilter}
              onChange={(value) => onFiltersChange({ ...filters, storageLocationFilter: value })}
            />
            <EmptyFilterSelect
              label="ASIN"
              value={filters.amazonAsinFilter}
              onChange={(value) => onFiltersChange({ ...filters, amazonAsinFilter: value })}
            />
            <EmptyFilterSelect
              label="Linked Lot"
              value={filters.linkedLotFilter}
              onChange={(value) => onFiltersChange({ ...filters, linkedLotFilter: value })}
            />
            <EmptyFilterSelect
              label="Notes"
              value={filters.notesFilter}
              onChange={(value) => onFiltersChange({ ...filters, notesFilter: value })}
            />
            <EmptyFilterSelect
              label="SKU"
              value={filters.skuFilter}
              onChange={(value) => onFiltersChange({ ...filters, skuFilter: value })}
            />
            <EmptyFilterSelect
              label="eBay Listing"
              value={filters.ebayListingFilter}
              onChange={(value) => onFiltersChange({ ...filters, ebayListingFilter: value })}
            />
            <EmptyFilterSelect
              label="Archive"
              value={filters.archiveLocationFilter}
              onChange={(value) => onFiltersChange({ ...filters, archiveLocationFilter: value })}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
