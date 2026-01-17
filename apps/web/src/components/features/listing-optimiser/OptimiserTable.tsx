'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, Package, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { OptimiserListing, SortConfig } from './types';

interface OptimiserTableProps {
  listings: OptimiserListing[];
  isLoading?: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onRowClick?: (listing: OptimiserListing) => void;
}

/**
 * Get grade badge variant
 */
function getGradeVariant(grade: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!grade) return 'outline';
  if (grade === 'A+' || grade === 'A') return 'default';
  if (grade === 'B') return 'secondary';
  return 'destructive';
}

/**
 * Format date relative to now
 */
function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export function OptimiserTable({
  listings,
  isLoading = false,
  selectedIds,
  onSelectionChange,
  onRowClick,
}: OptimiserTableProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'listingAge',
    direction: 'desc',
  });

  // Sort listings
  const sortedListings = useMemo(() => {
    return [...listings].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      // Handle null values
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;

      // Compare values
      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      }

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [listings, sortConfig]);

  // Handle sort
  const handleSort = useCallback((key: keyof OptimiserListing) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  // Handle select all
  const handleSelectAll = useCallback(
    (checked: boolean | 'indeterminate') => {
      if (checked === true) {
        onSelectionChange(new Set(listings.map((l) => l.itemId)));
      } else {
        onSelectionChange(new Set());
      }
    },
    [listings, onSelectionChange]
  );

  // Handle row selection
  const handleRowSelect = useCallback(
    (itemId: string, checked: boolean | 'indeterminate') => {
      const newSelection = new Set(selectedIds);
      if (checked === true) {
        newSelection.add(itemId);
      } else {
        newSelection.delete(itemId);
      }
      onSelectionChange(newSelection);
    },
    [selectedIds, onSelectionChange]
  );

  // Sort icon component
  const SortIcon = ({ column }: { column: keyof OptimiserListing }) => {
    if (sortConfig.key !== column) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  // Loading skeleton
  if (isLoading) {
    return <OptimiserTableSkeleton />;
  }

  // Empty state
  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">No listings found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          No active eBay listings match your filters.
        </p>
      </div>
    );
  }

  const allSelected = listings.length > 0 && selectedIds.size === listings.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < listings.length;

  return (
    <div className="rounded-md border">
      <div className="max-h-[600px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                  className={someSelected ? 'opacity-70' : ''}
                />
              </TableHead>
              <TableHead
                className="min-w-[250px] cursor-pointer select-none"
                onClick={() => handleSort('title')}
              >
                <div className="flex items-center">
                  Title
                  <SortIcon column="title" />
                </div>
              </TableHead>
              <TableHead
                className="w-[90px] text-right cursor-pointer select-none"
                onClick={() => handleSort('price')}
              >
                <div className="flex items-center justify-end">
                  Price
                  <SortIcon column="price" />
                </div>
              </TableHead>
              <TableHead
                className="w-[70px] text-right cursor-pointer select-none"
                onClick={() => handleSort('listingAge')}
              >
                <div className="flex items-center justify-end">
                  Age
                  <SortIcon column="listingAge" />
                </div>
              </TableHead>
              <TableHead
                className="w-[80px] text-right cursor-pointer select-none"
                onClick={() => handleSort('views')}
              >
                <div className="flex items-center justify-end">
                  Views
                  <SortIcon column="views" />
                </div>
              </TableHead>
              <TableHead
                className="w-[90px] text-right cursor-pointer select-none"
                onClick={() => handleSort('watchers')}
              >
                <div className="flex items-center justify-end">
                  Watchers
                  <SortIcon column="watchers" />
                </div>
              </TableHead>
              <TableHead className="w-[100px] text-center">Last Reviewed</TableHead>
              <TableHead
                className="w-[80px] text-center cursor-pointer select-none"
                onClick={() => handleSort('qualityScore')}
              >
                <div className="flex items-center justify-center">
                  Score
                  <SortIcon column="qualityScore" />
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedListings.map((listing) => (
              <TableRow
                key={listing.itemId}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onRowClick?.(listing)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(listing.itemId)}
                    onCheckedChange={(checked: boolean | 'indeterminate') => handleRowSelect(listing.itemId, checked)}
                    aria-label={`Select ${listing.title}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-start gap-2">
                    {listing.imageUrl && (
                      <img
                        src={listing.imageUrl}
                        alt=""
                        className="h-10 w-10 rounded object-cover flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-medium truncate">{listing.title}</span>
                        {listing.viewItemUrl && (
                          <a
                            href={listing.viewItemUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{listing.itemId}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  £{listing.price.toFixed(2)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {listing.listingAge}d
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {listing.views}
                </TableCell>
                <TableCell className="text-right">
                  {listing.watchers > 0 ? (
                    <Badge variant="secondary">{listing.watchers}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">
                  {formatRelativeDate(listing.lastReviewedAt)}
                </TableCell>
                <TableCell className="text-center">
                  {listing.qualityScore !== null ? (
                    <Badge variant={getGradeVariant(listing.qualityGrade)}>
                      {listing.qualityGrade} ({listing.qualityScore})
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Loading skeleton
 */
function OptimiserTableSkeleton() {
  return (
    <div className="rounded-md border">
      <div className="max-h-[600px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[40px]">
                <Skeleton className="h-4 w-4" />
              </TableHead>
              <TableHead className="min-w-[250px]">Title</TableHead>
              <TableHead className="w-[90px] text-right">Price</TableHead>
              <TableHead className="w-[70px] text-right">Age</TableHead>
              <TableHead className="w-[80px] text-right">Views</TableHead>
              <TableHead className="w-[90px] text-right">Watchers</TableHead>
              <TableHead className="w-[100px] text-center">Last Reviewed</TableHead>
              <TableHead className="w-[80px] text-center">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 10 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-4 w-4" />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-10 rounded" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-10 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-10 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-10 ml-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16 mx-auto" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-12 mx-auto" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
