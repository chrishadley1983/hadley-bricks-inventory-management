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
import { Settings2, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePlatformListings } from '@/hooks/use-platform-stock';
import { ListingsFilters } from './ListingsFilters';
import type { ListingFilters, PlatformListing, ListingStatus } from '@/lib/platform-stock';

interface ListingsViewProps {
  platform: string;
}

// Column definitions
type ColumnKey =
  | 'asin'
  | 'sku'
  | 'title'
  | 'quantity'
  | 'price'
  | 'status'
  | 'fulfillment'
  | 'condition';

const columns: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: 'asin', label: 'ASIN', defaultVisible: true },
  { key: 'sku', label: 'SKU', defaultVisible: true },
  { key: 'title', label: 'Title', defaultVisible: true },
  { key: 'quantity', label: 'Qty', defaultVisible: true },
  { key: 'price', label: 'Price', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'fulfillment', label: 'Fulfillment', defaultVisible: true },
  { key: 'condition', label: 'Condition', defaultVisible: false },
];

function getStatusBadgeVariant(status: ListingStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
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

export function ListingsView({ platform }: ListingsViewProps) {
  const [filters, setFilters] = useState<ListingFilters>({});
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    new Set(columns.filter((c) => c.defaultVisible).map((c) => c.key))
  );

  const { data, isLoading, error } = usePlatformListings(
    platform,
    filters,
    page,
    pageSize
  );

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

  const handleFiltersChange = (newFilters: ListingFilters) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Amazon Listings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-40" />
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
          <CardTitle>Amazon Listings</CardTitle>
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
            Amazon Listings
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
        <ListingsFilters filters={filters} onFiltersChange={handleFiltersChange} />

        {listings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No listings found</p>
            <p className="text-sm">
              {Object.keys(filters).length > 0
                ? 'Try adjusting your filters'
                : 'Import listings from Amazon to get started'}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.has('asin') && <TableHead>ASIN</TableHead>}
                    {visibleColumns.has('sku') && <TableHead>SKU</TableHead>}
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
                    {visibleColumns.has('fulfillment') && (
                      <TableHead>Fulfillment</TableHead>
                    )}
                    {visibleColumns.has('condition') && (
                      <TableHead>Condition</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.map((listing: PlatformListing) => (
                    <TableRow key={listing.id}>
                      {visibleColumns.has('asin') && (
                        <TableCell className="font-mono text-sm">
                          {listing.platformItemId}
                        </TableCell>
                      )}
                      {visibleColumns.has('sku') && (
                        <TableCell className="font-mono text-sm">
                          {listing.platformSku || '-'}
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
                      {visibleColumns.has('fulfillment') && (
                        <TableCell>
                          <Badge variant="outline">
                            {listing.fulfillmentChannel || '-'}
                          </Badge>
                        </TableCell>
                      )}
                      {visibleColumns.has('condition') && (
                        <TableCell>
                          {(listing.rawData as Record<string, string>)?.['item-condition'] || '-'}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
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
