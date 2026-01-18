'use client';

import { useState, useCallback } from 'react';
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
import { Input } from '@/components/ui/input';
import { Settings2, ChevronLeft, ChevronRight, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown, Check, X, Pencil } from 'lucide-react';
import { useEbayListings, useUpdateEbayPrice } from '@/hooks/use-ebay-stock';
import { useToast } from '@/hooks/use-toast';
import { EbayListingsFilters } from './EbayListingsFilters';
import { PriceUpdateDialog } from './PriceUpdateDialog';
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

// Sortable column keys (subset of ColumnKey that can be sorted)
type SortableColumnKey = 'sku' | 'itemId' | 'title' | 'quantity' | 'price' | 'status' | 'condition';

const columns: { key: ColumnKey; label: string; defaultVisible: boolean; sortable: boolean }[] = [
  { key: 'sku', label: 'SKU', defaultVisible: true, sortable: true },
  { key: 'itemId', label: 'Item ID', defaultVisible: true, sortable: true },
  { key: 'title', label: 'Title', defaultVisible: true, sortable: true },
  { key: 'quantity', label: 'Qty', defaultVisible: true, sortable: true },
  { key: 'price', label: 'Price', defaultVisible: true, sortable: true },
  { key: 'status', label: 'Status', defaultVisible: true, sortable: true },
  { key: 'condition', label: 'Condition', defaultVisible: true, sortable: false }, // Condition is in JSONB, harder to sort server-side
  { key: 'listingType', label: 'Type', defaultVisible: false, sortable: false },
  { key: 'watchers', label: 'Watchers', defaultVisible: false, sortable: false },
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

// Price editing state type
interface PriceEditState {
  itemId: string;
  itemTitle: string | null;
  currentPrice: number | null;
  editValue: string;
}

// Dialog state type
interface DialogState {
  isOpen: boolean;
  itemId: string;
  itemTitle: string | null;
  currentPrice: number | null;
  newPrice: number;
  result?: {
    success: boolean;
    autoAcceptPrice: number | null;
    minOfferPrice: number | null;
    error?: string;
  } | null;
}

export function EbayListingsView() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<EbayListingFilters>({});
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    new Set(columns.filter((c) => c.defaultVisible).map((c) => c.key))
  );

  // Price editing state
  const [editingPrice, setEditingPrice] = useState<PriceEditState | null>(null);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const { data, isLoading, error } = useEbayListings(filters, page, pageSize);
  const updatePriceMutation = useUpdateEbayPrice();

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

  const handleSort = (columnKey: SortableColumnKey) => {
    setFilters((prev) => {
      const currentSort = prev.sort;
      let newSort: EbayListingFilters['sort'];

      if (currentSort?.column === columnKey) {
        // Toggle direction or clear
        if (currentSort.direction === 'asc') {
          newSort = { column: columnKey, direction: 'desc' };
        } else {
          // Clear sort (return to default)
          newSort = undefined;
        }
      } else {
        // New column, start with ascending
        newSort = { column: columnKey, direction: 'asc' };
      }

      return { ...prev, sort: newSort };
    });
    setPage(1);
  };

  const getSortIcon = (columnKey: ColumnKey) => {
    const sortableKey = columnKey as SortableColumnKey;
    if (filters.sort?.column === sortableKey) {
      return filters.sort.direction === 'asc' ? (
        <ArrowUp className="ml-1 h-3 w-3" />
      ) : (
        <ArrowDown className="ml-1 h-3 w-3" />
      );
    }
    return <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />;
  };

  const renderSortableHeader = (column: typeof columns[number], className?: string) => {
    if (!column.sortable) {
      return <TableHead className={className}>{column.label}</TableHead>;
    }
    const isRightAligned = className?.includes('text-right');
    const isCenterAligned = className?.includes('text-center');
    return (
      <TableHead className={className}>
        <button
          type="button"
          className={`inline-flex items-center hover:text-foreground transition-colors ${isRightAligned ? 'w-full justify-end' : ''} ${isCenterAligned ? 'w-full justify-center' : ''}`}
          onClick={() => handleSort(column.key as SortableColumnKey)}
        >
          {column.label}
          {getSortIcon(column.key)}
        </button>
      </TableHead>
    );
  };

  // Price editing handlers
  const startEditingPrice = useCallback((listing: PlatformListing) => {
    setEditingPrice({
      itemId: listing.platformItemId,
      itemTitle: listing.title,
      currentPrice: listing.price,
      editValue: listing.price?.toFixed(2) ?? '',
    });
  }, []);

  const cancelEditingPrice = useCallback(() => {
    setEditingPrice(null);
  }, []);

  const handlePriceInputChange = useCallback((value: string) => {
    // Only allow valid price input (numbers and one decimal point)
    if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
      setEditingPrice((prev) => (prev ? { ...prev, editValue: value } : null));
    }
  }, []);

  const submitPriceEdit = useCallback(() => {
    if (!editingPrice) return;

    const newPrice = parseFloat(editingPrice.editValue);
    if (isNaN(newPrice) || newPrice <= 0) {
      toast({
        title: 'Invalid Price',
        description: 'Please enter a valid price greater than 0',
        variant: 'destructive',
      });
      return;
    }

    // Open confirmation dialog
    setDialogState({
      isOpen: true,
      itemId: editingPrice.itemId,
      itemTitle: editingPrice.itemTitle,
      currentPrice: editingPrice.currentPrice,
      newPrice,
      result: null,
    });
  }, [editingPrice, toast]);

  const handleDialogClose = useCallback(() => {
    setDialogState(null);
    setEditingPrice(null);
  }, []);

  const handleDialogConfirm = useCallback(
    async (params: { updateBestOffer: boolean; autoAcceptPercent: number; minOfferPercent: number }) => {
      if (!dialogState) return;

      try {
        const result = await updatePriceMutation.mutateAsync({
          itemId: dialogState.itemId,
          newPrice: dialogState.newPrice,
          updateBestOffer: params.updateBestOffer,
          autoAcceptPercent: params.autoAcceptPercent,
          minOfferPercent: params.minOfferPercent,
        });

        // Show success in dialog
        setDialogState((prev) =>
          prev
            ? {
                ...prev,
                result: {
                  success: true,
                  autoAcceptPrice: result.autoAcceptPrice,
                  minOfferPrice: result.minOfferPrice,
                },
              }
            : null
        );

        toast({
          title: 'Price Updated',
          description: `Price updated to ${formatPrice(dialogState.newPrice)}`,
        });
      } catch (error) {
        // Show error in dialog
        setDialogState((prev) =>
          prev
            ? {
                ...prev,
                result: {
                  success: false,
                  autoAcceptPrice: null,
                  minOfferPrice: null,
                  error: error instanceof Error ? error.message : 'Unknown error',
                },
              }
            : null
        );
      }
    },
    [dialogState, updatePriceMutation, toast]
  );

  // Render price cell with edit capability
  const renderPriceCell = (listing: PlatformListing) => {
    const isEditing = editingPrice?.itemId === listing.platformItemId;

    if (isEditing) {
      return (
        <TableCell className="text-center">
          <div className="flex items-center justify-center gap-1">
            <span className="text-muted-foreground">£</span>
            <Input
              type="text"
              inputMode="decimal"
              value={editingPrice.editValue}
              onChange={(e) => handlePriceInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitPriceEdit();
                if (e.key === 'Escape') cancelEditingPrice();
              }}
              className="w-20 h-7 text-right text-sm"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={submitPriceEdit}
              title="Confirm price change"
            >
              <Check className="h-4 w-4 text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={cancelEditingPrice}
              title="Cancel"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </TableCell>
      );
    }

    return (
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1 group">
          <span>{formatPrice(listing.price)}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => startEditingPrice(listing)}
            title="Edit price"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    );
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
                    {visibleColumns.has('sku') && renderSortableHeader(columns[0])}
                    {visibleColumns.has('itemId') && renderSortableHeader(columns[1])}
                    {visibleColumns.has('title') && renderSortableHeader(columns[2], 'min-w-[200px]')}
                    {visibleColumns.has('quantity') && renderSortableHeader(columns[3], 'text-right')}
                    {visibleColumns.has('price') && renderSortableHeader(columns[4], 'text-center')}
                    {visibleColumns.has('status') && renderSortableHeader(columns[5])}
                    {visibleColumns.has('condition') && renderSortableHeader(columns[6])}
                    {visibleColumns.has('listingType') && renderSortableHeader(columns[7])}
                    {visibleColumns.has('watchers') && renderSortableHeader(columns[8], 'text-right')}
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
                        {visibleColumns.has('price') && renderPriceCell(listing)}
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

      {/* Price Update Confirmation Dialog */}
      {dialogState && (
        <PriceUpdateDialog
          isOpen={dialogState.isOpen}
          onClose={handleDialogClose}
          onConfirm={handleDialogConfirm}
          itemId={dialogState.itemId}
          itemTitle={dialogState.itemTitle}
          currentPrice={dialogState.currentPrice}
          newPrice={dialogState.newPrice}
          isUpdating={updatePriceMutation.isPending}
          updateResult={dialogState.result}
        />
      )}
    </Card>
  );
}
