'use client';

import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Package } from 'lucide-react';
import { RepricingRow } from './RepricingRow';
import type { RepricingItem } from '@/lib/repricing';

interface RepricingTableProps {
  items: RepricingItem[];
  isLoading?: boolean;
}

export function RepricingTable({ items, isLoading = false }: RepricingTableProps) {
  // Loading skeleton
  if (isLoading) {
    return <RepricingTableSkeleton />;
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">No listings found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          No Amazon listings with quantity &ge; 1 were found.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <div className="max-h-[600px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[120px]">ASIN</TableHead>
              <TableHead className="w-[100px]">SKU</TableHead>
              <TableHead className="min-w-[200px]">Title</TableHead>
              <TableHead className="w-[60px] text-right">Qty</TableHead>
              <TableHead className="w-[120px] text-right">Your Price</TableHead>
              <TableHead className="w-[100px] text-right">Buy Box</TableHead>
              <TableHead className="w-[80px] text-right">Diff</TableHead>
              <TableHead className="w-[100px] text-right">Was Price</TableHead>
              <TableHead className="w-[120px] text-right">Cost</TableHead>
              <TableHead className="w-[90px] text-right">Profit</TableHead>
              <TableHead className="w-[60px] text-center">Push</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <RepricingRow key={`${item.asin}-${item.sku}`} item={item} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Loading skeleton for the table
 */
function RepricingTableSkeleton() {
  return (
    <div className="rounded-md border">
      <div className="max-h-[600px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[120px]">ASIN</TableHead>
              <TableHead className="w-[100px]">SKU</TableHead>
              <TableHead className="min-w-[200px]">Title</TableHead>
              <TableHead className="w-[60px] text-right">Qty</TableHead>
              <TableHead className="w-[120px] text-right">Your Price</TableHead>
              <TableHead className="w-[100px] text-right">Buy Box</TableHead>
              <TableHead className="w-[80px] text-right">Diff</TableHead>
              <TableHead className="w-[100px] text-right">Was Price</TableHead>
              <TableHead className="w-[120px] text-right">Cost</TableHead>
              <TableHead className="w-[90px] text-right">Profit</TableHead>
              <TableHead className="w-[60px] text-center">Push</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 10 }).map((_, i) => (
              <TableRow key={i}>
                <td className="p-2">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-40" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-8 ml-auto" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-16 ml-auto" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-16 ml-auto" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-12 ml-auto" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-16 ml-auto" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-16 ml-auto" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-4 w-14 ml-auto" />
                </td>
                <td className="p-2">
                  <Skeleton className="h-8 w-8 mx-auto" />
                </td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
