'use client';

import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, BarChart3, AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import type { OptimiserFilters, ListingOptimiserSummary } from './types';

interface OptimiserFiltersProps {
  filters: OptimiserFilters;
  onFiltersChange: (filters: OptimiserFilters) => void;
  summary?: ListingOptimiserSummary;
  selectedCount?: number;
  onAnalyse?: () => void;
  isAnalysing?: boolean;
  onSync?: () => void;
  isSyncing?: boolean;
}

export function OptimiserFilters({
  filters,
  onFiltersChange,
  summary,
  selectedCount = 0,
  onAnalyse,
  isAnalysing = false,
  onSync,
  isSyncing = false,
}: OptimiserFiltersProps) {
  const [searchValue, setSearchValue] = useState(filters.search || '');

  // Debounced search
  const debouncedSearch = useDebouncedCallback((value: string) => {
    onFiltersChange({
      ...filters,
      search: value || undefined,
    });
  }, 300);

  // Handle search input change
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchValue(value);
      debouncedSearch(value);
    },
    [debouncedSearch]
  );

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchValue('');
    onFiltersChange({
      ...filters,
      search: undefined,
    });
  }, [filters, onFiltersChange]);

  // Handle filter changes
  const handleGradeChange = useCallback(
    (value: string) => {
      onFiltersChange({
        ...filters,
        qualityGrade: value === 'all' ? undefined : (value as OptimiserFilters['qualityGrade']),
      });
    },
    [filters, onFiltersChange]
  );

  const handleReviewedChange = useCallback(
    (value: string) => {
      onFiltersChange({
        ...filters,
        reviewedStatus: value === 'all' ? undefined : (value as OptimiserFilters['reviewedStatus']),
      });
    },
    [filters, onFiltersChange]
  );

  const handleMinAgeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
      onFiltersChange({
        ...filters,
        minAge: value,
      });
    },
    [filters, onFiltersChange]
  );

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {summary && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total:</span>
            <Badge variant="outline">{summary.totalListings}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-sm text-muted-foreground">Reviewed:</span>
            <Badge variant="outline">{summary.reviewedCount}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Avg Score:</span>
            <Badge
              variant={summary.averageScore && summary.averageScore >= 70 ? 'default' : 'secondary'}
            >
              {summary.averageScore?.toFixed(1) || '-'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm text-muted-foreground">Low Score:</span>
            <Badge variant="destructive">{summary.lowScoreCount}</Badge>
          </div>
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title, item ID..."
            value={searchValue}
            onChange={handleSearchChange}
            className="pl-10 pr-8"
          />
          {searchValue && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
              onClick={handleClearSearch}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Quality Grade filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Grade:</Label>
          <Select value={filters.qualityGrade || 'all'} onValueChange={handleGradeChange}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="A+">A+</SelectItem>
              <SelectItem value="A">A</SelectItem>
              <SelectItem value="B">B</SelectItem>
              <SelectItem value="C">C</SelectItem>
              <SelectItem value="D">D</SelectItem>
              <SelectItem value="F">F</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Reviewed status filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Status:</Label>
          <Select value={filters.reviewedStatus || 'all'} onValueChange={handleReviewedChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="not_reviewed">Not Reviewed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Min Age filter */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">
            <Clock className="inline h-3.5 w-3.5 mr-1" />
            Min Age:
          </Label>
          <Input
            type="number"
            placeholder="days"
            value={filters.minAge || ''}
            onChange={handleMinAgeChange}
            className="w-[80px]"
            min={0}
          />
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
          )}
          {onSync && (
            <Button variant="outline" onClick={onSync} disabled={isSyncing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync eBay'}
            </Button>
          )}
          <Button onClick={onAnalyse} disabled={selectedCount === 0 || isAnalysing}>
            {isAnalysing ? (
              <>
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Analysing...
              </>
            ) : (
              'Analyse'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
