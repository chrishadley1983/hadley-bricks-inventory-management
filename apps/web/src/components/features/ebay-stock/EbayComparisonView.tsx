'use client';

import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, ChevronRight, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useEbayStockComparison } from '@/hooks/use-ebay-stock';
import { ComparisonSummary } from '@/components/features/platform-stock/ComparisonSummary';
import { DiscrepancyBadge } from '@/components/features/platform-stock/DiscrepancyBadge';
import { EbayComparisonFilters } from './EbayComparisonFilters';
import type { EbayComparisonFilters as EbayComparisonFiltersType } from '@/lib/platform-stock/ebay/types';
import type { EbayStockComparison } from '@/lib/platform-stock/ebay/types';
import type { DiscrepancyType, InventoryItemSummary } from '@/lib/platform-stock/types';

function formatPrice(price: number | null): string {
  if (price === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(price);
}

function formatDifference(diff: number): string {
  if (diff === 0) return '0';
  const prefix = diff > 0 ? '+' : '';
  return prefix + diff;
}

export function EbayComparisonView() {
  const [filters, setFilters] = useState<EbayComparisonFiltersType>({});
  const [selectedComparison, setSelectedComparison] = useState<EbayStockComparison | null>(null);

  const { data, isLoading, error } = useEbayStockComparison(filters);

  // Apply client-side filtering for hideZeroQuantities
  const filteredComparisons = useMemo(() => {
    if (!data?.comparisons) return [];

    let result = data.comparisons;

    // Hide items where both platform and inventory quantities are 0
    if (filters.hideZeroQuantities) {
      result = result.filter((c) => !(c.platformQuantity === 0 && c.inventoryQuantity === 0));
    }

    return result;
  }, [data?.comparisons, filters.hideZeroQuantities]);

  // Count condition mismatches
  const conditionMismatchCount = useMemo(() => {
    return data?.comparisons?.filter((c) => c.conditionMismatch).length || 0;
  }, [data?.comparisons]);

  // Handler for clicking on summary cards
  const handleFilterClick = (filter: DiscrepancyType | 'all') => {
    setFilters((prev) => ({
      ...prev,
      discrepancyType: filter === 'all' ? undefined : filter,
      hideZeroQuantities: filter === 'match' ? prev.hideZeroQuantities : undefined,
    }));
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <ComparisonSummary summary={null} isLoading />
        <Card>
          <CardHeader>
            <CardTitle>Stock Comparison</CardTitle>
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
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>Failed to load comparison data</p>
            <p className="text-sm">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { summary } = data || { comparisons: [], summary: null };

  return (
    <div className="space-y-6">
      <ComparisonSummary
        summary={summary}
        activeFilter={filters.discrepancyType || 'all'}
        onFilterClick={handleFilterClick}
      />

      {/* Condition mismatch warning */}
      {conditionMismatchCount > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">
            {conditionMismatchCount} item{conditionMismatchCount !== 1 ? 's have' : ' has'}{' '}
            condition mismatches between eBay and inventory
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Stock Comparison
            {filteredComparisons.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filteredComparisons.length} items)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <EbayComparisonFilters filters={filters} onFiltersChange={setFilters} />

          {filteredComparisons.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No comparison data available</p>
              <p className="text-sm">
                {Object.keys(filters).length > 0
                  ? 'Try adjusting your filters'
                  : 'Import eBay listings to start comparing'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="min-w-[200px]">Title</TableHead>
                    <TableHead className="text-center">eBay Qty</TableHead>
                    <TableHead className="text-center">Inventory Qty</TableHead>
                    <TableHead className="text-center">Difference</TableHead>
                    <TableHead className="text-right">eBay Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredComparisons.map((comparison) => (
                    <TableRow
                      key={comparison.platformItemId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedComparison(comparison)}
                    >
                      <TableCell className="font-mono text-sm">
                        {comparison.platformSku || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell
                        className="max-w-[300px] truncate"
                        title={comparison.platformTitle || undefined}
                      >
                        <div className="flex items-center gap-2">
                          {comparison.platformTitle ||
                            comparison.inventoryItems[0]?.itemName ||
                            '-'}
                          {comparison.conditionMismatch && (
                            <Badge variant="outline" className="text-yellow-600 border-yellow-400">
                              Condition
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-medium">
                        {comparison.platformQuantity}
                      </TableCell>
                      <TableCell className="text-center font-medium">
                        {comparison.inventoryQuantity}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={
                            comparison.quantityDifference > 0
                              ? 'text-orange-600 font-medium'
                              : comparison.quantityDifference < 0
                                ? 'text-red-600 font-medium'
                                : 'text-green-600'
                          }
                        >
                          {formatDifference(comparison.quantityDifference)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPrice(comparison.platformPrice)}
                      </TableCell>
                      <TableCell>
                        <DiscrepancyBadge type={comparison.discrepancyType} />
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <EbayComparisonDetailSheet
        comparison={selectedComparison}
        onClose={() => setSelectedComparison(null)}
      />
    </div>
  );
}

// Detail sheet component
interface EbayComparisonDetailSheetProps {
  comparison: EbayStockComparison | null;
  onClose: () => void;
}

function EbayComparisonDetailSheet({ comparison, onClose }: EbayComparisonDetailSheetProps) {
  if (!comparison) return null;

  return (
    <Sheet open={!!comparison} onOpenChange={() => onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {comparison.platformSku || 'No SKU'}
            <DiscrepancyBadge type={comparison.discrepancyType} />
          </SheetTitle>
          <SheetDescription>{comparison.platformTitle || 'No title available'}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Platform Data */}
          <div>
            <h3 className="font-semibold mb-3">eBay Listing</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Quantity</p>
                <p className="font-medium">{comparison.platformQuantity}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Price</p>
                <p className="font-medium">{formatPrice(comparison.platformPrice)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">SKU</p>
                <p className="font-mono text-xs">{comparison.platformSku || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Item ID</p>
                <p className="font-mono text-xs">{comparison.ebayItemId || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Condition (eBay)</p>
                <p>{comparison.ebayCondition || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Listing Type</p>
                <Badge variant="outline">{comparison.listingType || '-'}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <p>{comparison.platformListingStatus || '-'}</p>
              </div>
            </div>

            {/* Condition mismatch warning */}
            {comparison.conditionMismatch && (
              <div className="mt-3 flex items-center gap-2 p-2 rounded bg-yellow-50 text-yellow-800 text-sm">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  Condition mismatch: eBay shows &quot;{comparison.ebayCondition}&quot; but
                  inventory has &quot;{comparison.inventoryCondition}&quot;
                </span>
              </div>
            )}

            {comparison.viewItemUrl && (
              <Button variant="link" size="sm" className="px-0 mt-2" asChild>
                <a href={comparison.viewItemUrl} target="_blank" rel="noopener noreferrer">
                  View on eBay
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
          </div>

          {/* Inventory Data */}
          <div>
            <h3 className="font-semibold mb-3">Inventory ({comparison.inventoryQuantity} items)</h3>

            {comparison.inventoryItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching inventory items found</p>
            ) : (
              <div className="space-y-3">
                {comparison.inventoryItems.map((item) => (
                  <InventoryItemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* Difference Summary */}
          {comparison.discrepancyType !== 'match' && (
            <div className="rounded-lg bg-muted p-4">
              <h3 className="font-semibold mb-2">Discrepancy</h3>
              <p className="text-sm">
                {comparison.discrepancyType === 'platform_only' &&
                  `This item is listed on eBay but not found in inventory. Consider adding ${comparison.platformQuantity} item(s) to inventory.`}
                {comparison.discrepancyType === 'inventory_only' &&
                  `This item is in inventory but not listed on eBay. Consider creating a listing or updating the SKU.`}
                {comparison.discrepancyType === 'quantity_mismatch' &&
                  `eBay shows ${comparison.platformQuantity} while inventory has ${comparison.inventoryQuantity}. Difference: ${formatDifference(comparison.quantityDifference)}`}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Inventory item card
interface InventoryItemCardProps {
  item: InventoryItemSummary;
}

function InventoryItemCard({ item }: InventoryItemCardProps) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium">{item.setNumber}</p>
          <p className="text-sm text-muted-foreground line-clamp-1">{item.itemName || 'No name'}</p>
        </div>
        <Badge variant="secondary">{item.condition || 'N/A'}</Badge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-muted-foreground">Value</p>
          <p>{formatPrice(item.listingValue)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Location</p>
          <p>{item.storageLocation || '-'}</p>
        </div>
        {item.sku && (
          <div className="col-span-2">
            <p className="text-muted-foreground">SKU</p>
            <p className="font-mono text-xs">{item.sku}</p>
          </div>
        )}
      </div>
      <Button variant="link" size="sm" className="px-0 mt-1" asChild>
        <Link href={`/inventory/${item.id}`}>
          View in Inventory
          <ChevronRight className="ml-1 h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}
