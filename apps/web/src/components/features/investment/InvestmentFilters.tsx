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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Search, X, Filter, ChevronDown } from 'lucide-react';
import { useInvestmentThemes } from '@/hooks/use-investment';
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

const EXCLUSIVITY_OPTIONS = [
  { value: 'all', label: 'All Exclusivity' },
  { value: 'standard', label: 'Standard' },
  { value: 'lego_exclusive', label: 'LEGO Exclusive' },
  { value: 'retailer_exclusive', label: 'Retailer Exclusive' },
  { value: 'event_exclusive', label: 'Event Exclusive' },
];

export function InvestmentFilters({ filters, onFiltersChange }: InvestmentFiltersProps) {
  const { data: themes = [] } = useInvestmentThemes();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Count advanced filters that are active
  const advancedFilterCount = [
    filters.minPieces,
    filters.maxPieces,
    filters.minRrp,
    filters.maxRrp,
    filters.isLicensed,
    filters.isUcs,
    filters.isModular,
    filters.exclusivityTier,
    filters.hasAmazon,
  ].filter((v) => v != null).length;

  const hasActiveFilters = !!(
    filters.search ||
    filters.retirementStatus ||
    filters.theme ||
    filters.minYear ||
    filters.maxYear ||
    filters.retiringWithinMonths ||
    advancedFilterCount > 0
  );

  const [searchValue, setSearchValue] = useState(filters.search || '');
  const [minPiecesValue, setMinPiecesValue] = useState(
    filters.minPieces != null ? String(filters.minPieces) : ''
  );
  const [maxPiecesValue, setMaxPiecesValue] = useState(
    filters.maxPieces != null ? String(filters.maxPieces) : ''
  );
  const [minRrpValue, setMinRrpValue] = useState(
    filters.minRrp != null ? String(filters.minRrp) : ''
  );
  const [maxRrpValue, setMaxRrpValue] = useState(
    filters.maxRrp != null ? String(filters.maxRrp) : ''
  );

  useEffect(() => {
    setSearchValue(filters.search || '');
  }, [filters.search]);

  useEffect(() => {
    setMinPiecesValue(filters.minPieces != null ? String(filters.minPieces) : '');
    setMaxPiecesValue(filters.maxPieces != null ? String(filters.maxPieces) : '');
    setMinRrpValue(filters.minRrp != null ? String(filters.minRrp) : '');
    setMaxRrpValue(filters.maxRrp != null ? String(filters.maxRrp) : '');
  }, [filters.minPieces, filters.maxPieces, filters.minRrp, filters.maxRrp]);

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
    setMinPiecesValue('');
    setMaxPiecesValue('');
    setMinRrpValue('');
    setMaxRrpValue('');
    onFiltersChange({});
  };

  const commitNumericFilter = (field: keyof Filters, value: string) => {
    const num = value ? Number(value) : undefined;
    onFiltersChange({ ...filters, [field]: num && !isNaN(num) ? num : undefined });
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Search, Retirement Status, Retiring Within, Clear */}
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
              retirementStatus:
                value === 'all' ? undefined : (value as Filters['retirementStatus']),
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

      {/* Row 2: Theme dropdown, Min/Max Year */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Select
          value={filters.theme || 'all'}
          onValueChange={(value: string) =>
            onFiltersChange({ ...filters, theme: value === 'all' ? undefined : value })
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Themes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Themes</SelectItem>
            {themes.map((theme) => (
              <SelectItem key={theme} value={theme}>
                {theme}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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

      {/* Row 3: Collapsible Advanced Filters */}
      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            Advanced
            {advancedFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {advancedFilterCount}
              </Badge>
            )}
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                isAdvancedOpen ? 'rotate-180' : ''
              }`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-4">
          {/* Pieces and RRP ranges */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Pieces</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  value={minPiecesValue}
                  onChange={(e) => setMinPiecesValue(e.target.value)}
                  onBlur={() => commitNumericFilter('minPieces', minPiecesValue)}
                  className="w-[100px]"
                />
                <span className="text-muted-foreground">-</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={maxPiecesValue}
                  onChange={(e) => setMaxPiecesValue(e.target.value)}
                  onBlur={() => commitNumericFilter('maxPieces', maxPiecesValue)}
                  className="w-[100px]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">RRP</Label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    &pound;
                  </span>
                  <Input
                    type="number"
                    placeholder="Min"
                    value={minRrpValue}
                    onChange={(e) => setMinRrpValue(e.target.value)}
                    onBlur={() => commitNumericFilter('minRrp', minRrpValue)}
                    className="w-[100px] pl-7"
                  />
                </div>
                <span className="text-muted-foreground">-</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    &pound;
                  </span>
                  <Input
                    type="number"
                    placeholder="Max"
                    value={maxRrpValue}
                    onChange={(e) => setMaxRrpValue(e.target.value)}
                    onBlur={() => commitNumericFilter('maxRrp', maxRrpValue)}
                    className="w-[100px] pl-7"
                  />
                </div>
              </div>
            </div>

            <Select
              value={filters.exclusivityTier || 'all'}
              onValueChange={(value: string) =>
                onFiltersChange({
                  ...filters,
                  exclusivityTier: value === 'all' ? undefined : value,
                })
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Exclusivity" />
              </SelectTrigger>
              <SelectContent>
                {EXCLUSIVITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Classification checkboxes */}
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="filter-licensed"
                checked={filters.isLicensed === true}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  onFiltersChange({
                    ...filters,
                    isLicensed: checked === true ? true : undefined,
                  })
                }
              />
              <Label htmlFor="filter-licensed" className="text-sm cursor-pointer">
                Licensed
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="filter-ucs"
                checked={filters.isUcs === true}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  onFiltersChange({
                    ...filters,
                    isUcs: checked === true ? true : undefined,
                  })
                }
              />
              <Label htmlFor="filter-ucs" className="text-sm cursor-pointer">
                UCS
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="filter-modular"
                checked={filters.isModular === true}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  onFiltersChange({
                    ...filters,
                    isModular: checked === true ? true : undefined,
                  })
                }
              />
              <Label htmlFor="filter-modular" className="text-sm cursor-pointer">
                Modular
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="filter-has-amazon"
                checked={filters.hasAmazon === true}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  onFiltersChange({
                    ...filters,
                    hasAmazon: checked === true ? true : undefined,
                  })
                }
              />
              <Label htmlFor="filter-has-amazon" className="text-sm cursor-pointer">
                Has Amazon Listing
              </Label>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
