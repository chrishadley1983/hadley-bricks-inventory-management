'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Settings2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useEbayListings } from '@/hooks/use-ebay-stock';
import { EbayListingsFilters } from './EbayListingsFilters';
import type { EbayListingFilters, EbayListingData } from '@/lib/platform-stock/ebay/types';
import type { PlatformListing, ListingStatus } from '@/lib/platform-stock/types';

// Column definitions
type ColumnKey =
  | 'sku'
  | 'itemId'
  | 'title'
  | 'quantity'
  | 'price'
  | 'status'
  | 'condition'
  | 'listingType'
  | 'watchers';

const columns: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: 'sku', label: 'SKU', defaultVisible: true },
  { key: 'itemId', label: 'Item ID', defaultVisible: true },
  { key: 'title', label: 'Title', defaultVisible: true },
  { key: 'quantity', label: 'Qty', defaultVisible: true },
  { key: 'price', label: 'Price', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'condition', label: 'Condition', defaultVisible: true },
  { key: 'listingType', label: 'Type', defaultVisible: false },
  { key: 'watchers', label: 'Watchers', defaultVisible: false },
];

function getStatusBadgeVariant(
  status: ListingStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'Active':
      return 'default';
    case 'Inactive':
      return 'secondary';
    case 'Incomplete':
    case 'Out of Stock':
      return 'destructive';
    default:
      return 'outline';
  }
}

function formatPrice(price: number | null): string {
  if (price === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(price);
}

export function EbayListingsView() {
  const [filters, setFilters] = useState<EbayListingFilters>({});
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    new Set(columns.filter((c) => c.defaultVisible).map((c) => c.key))
  );

  const { data, isLoading, error } = useEbayListings(filters, page, pageSize);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleFiltersChange = (newFilters: EbayListingFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>eBay Listings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-40" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>eBay Listings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>Failed to load listings</p>
            <p className="text-sm">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { listings, pagination } = data || { listings: [], pagination: null };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            eBay Listings
            {pagination && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({pagination.total} items)
              </span>
            )}
          </CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.key}
                  checked={visibleColumns.has(column.key)}
                  onCheckedChange={() => toggleColumn(column.key)}
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <EbayListingsFilters filters={filters} onFiltersChange={handleFiltersChange} />

        {listings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No listings found</p>
            <p className="text-sm">
              {Object.keys(filters).length > 0
                ? 'Try adjusting your filters'
                : 'Import listings from eBay to get started'}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.has('sku') && <TableHead>SKU</TableHead>}
                    {visibleColumns.has('itemId') && <TableHead>Item ID</TableHead>}
                    {visibleColumns.has('title') && (
                      <TableHead className="min-w-[200px]">Title</TableHead>
                    )}
                    {visibleColumns.has('quantity') && (
                      <TableHead className="text-right">Qty</TableHead>
                    )}
                    {visibleColumns.has('price') && (
                      <TableHead className="text-right">Price</TableHead>
                    )}
                    {visibleColumns.has('status') && <TableHead>Status</TableHead>}
                    {visibleColumns.has('condition') && <TableHead>Condition</TableHead>}
                    {visibleColumns.has('listingType') && <TableHead>Type</TableHead>}
                    {visibleColumns.has('watchers') && (
                      <TableHead className="text-right">Watchers</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.map((listing: PlatformListing) => {
                    const ebayData = (listing.rawData as unknown as EbayListingData) || {};
                    return (
                      <TableRow key={listing.id}>
                        {visibleColumns.has('sku') && (
                          <TableCell className="font-mono text-sm">
                            {listing.platformSku || (
                              <span className="text-destructive">Empty</span>
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.has('itemId') && (
                          <TableCell className="font-mono text-sm">
                            {ebayData.viewItemUrl ? (
                              <a
                                href={ebayData.viewItemUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 hover:underline text-blue-600"
                              >
                                {listing.platformItemId}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              listing.platformItemId
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.has('title') && (
                          <TableCell
                            className="max-w-[300px] truncate"
                            title={listing.title || undefined}
                          >
                            {listing.title || '-'}
                          </TableCell>
                        )}
                        {visibleColumns.has('quantity') && (
                          <TableCell className="text-right font-medium">
                            {listing.quantity}
                          </TableCell>
                        )}
                        {visibleColumns.has('price') && (
                          <TableCell className="text-right">
                            {formatPrice(listing.price)}
                          </TableCell>
                        )}
                        {visibleColumns.has('status') && (
                          <TableCell>
                            <Badge variant={getStatusBadgeVariant(listing.listingStatus)}>
                              {listing.listingStatus}
                            </Badge>
                          </TableCell>
                        )}
                        {visibleColumns.has('condition') && (
                          <TableCell>{ebayData.condition || '-'}</TableCell>
                        )}
                        {visibleColumns.has('listingType') && (
                          <TableCell>
                            <Badge variant="outline">{ebayData.format || '-'}</Badge>
                          </TableCell>
                        )}
                        {visibleColumns.has('watchers') && (
                          <TableCell className="text-right">
                            {ebayData.watchers ?? '-'}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pagination.page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(pagination.totalPages, p + 1))
                    }
                    disabled={pagination.page >= pagination.totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
