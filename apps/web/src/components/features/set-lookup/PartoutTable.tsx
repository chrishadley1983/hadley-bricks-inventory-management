'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, Database, ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PartValue } from '@/types/partout';

/**
 * Generate BrickLink catalog URL for a part with specific colour
 */
function getBrickLinkUrl(part: PartValue): string {
  const typeCode = part.partType === 'MINIFIG' ? 'M' : 'P';
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?${typeCode}=${encodeURIComponent(part.partNumber)}&C=${part.colourId}`;
}

export type PartoutCondition = 'new' | 'used';

interface PartoutTableProps {
  parts: PartValue[];
  condition: PartoutCondition;
}

/**
 * Format a number as GBP currency
 */
function formatCurrency(value: number | null): string {
  if (value === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format sell-through rate as percentage
 */
function formatPercentage(value: number | null): string {
  if (value === null) return '-';
  return `${value.toFixed(1)}%`;
}

/**
 * Part image cell with fallback
 */
function PartImageCell({ part }: { part: PartValue }) {
  const [imgError, setImgError] = useState(false);

  if (imgError || !part.imageUrl) {
    return (
      <div className="w-10 h-10 bg-muted flex items-center justify-center rounded text-xs text-muted-foreground">
        N/A
      </div>
    );
  }

  return (
    <div className="relative w-10 h-10">
      <Image
        src={part.imageUrl}
        alt={part.name}
        fill
        sizes="40px"
        className="object-contain rounded"
        onError={() => setImgError(true)}
      />
    </div>
  );
}

/**
 * Create column definitions based on condition
 */
function createColumns(condition: PartoutCondition): ColumnDef<PartValue>[] {
  return [
    {
      id: 'image',
      header: 'Image',
      cell: ({ row }) => <PartImageCell part={row.original} />,
      enableSorting: false,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="max-w-[250px]">
          <div className="font-medium truncate" title={row.original.name}>
            {row.original.name}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <a
              href={getBrickLinkUrl(row.original)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary hover:underline inline-flex items-center gap-1"
              title="View on BrickLink"
            >
              {row.original.partNumber}
              <ExternalLink className="h-3 w-3" />
            </a>
            {row.original.partType === 'MINIFIG' && (
              <Badge variant="secondary" className="ml-1 text-[10px] py-0">
                Minifig
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'colourName',
      header: 'Colour',
      cell: ({ row }) => (
        <span className="text-sm">{row.original.colourName}</span>
      ),
    },
    {
      accessorKey: 'quantity',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Qty
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.quantity}</span>
      ),
    },
    {
      id: 'price',
      accessorFn: (row) => condition === 'new' ? row.priceNew : row.priceUsed,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Price
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => formatCurrency(condition === 'new' ? row.original.priceNew : row.original.priceUsed),
    },
    {
      id: 'total',
      accessorFn: (row) => condition === 'new' ? row.totalNew : row.totalUsed,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Total
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className={`font-medium ${condition === 'new' ? 'text-green-700' : 'text-blue-700'}`}>
          {formatCurrency(condition === 'new' ? row.original.totalNew : row.original.totalUsed)}
        </span>
      ),
    },
    {
      id: 'sellThroughRate',
      accessorFn: (row) => condition === 'new' ? row.sellThroughRateNew : row.sellThroughRateUsed,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Sell-Through
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => formatPercentage(condition === 'new' ? row.original.sellThroughRateNew : row.original.sellThroughRateUsed),
    },
    {
      id: 'stockAvailable',
      accessorFn: (row) => condition === 'new' ? row.stockAvailableNew : row.stockAvailableUsed,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Stock
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (condition === 'new' ? row.original.stockAvailableNew : row.original.stockAvailableUsed) ?? '-',
    },
    {
      id: 'timesSold',
      accessorFn: (row) => condition === 'new' ? row.timesSoldNew : row.timesSoldUsed,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Sold
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (condition === 'new' ? row.original.timesSoldNew : row.original.timesSoldUsed) ?? '-',
    },
    {
      id: 'cache',
      header: '',
      cell: ({ row }) =>
        row.original.fromCache ? (
          <span title="From cache">
            <Database className="h-4 w-4 text-muted-foreground" />
          </span>
        ) : null,
      enableSorting: false,
    },
  ];
}

/**
 * PartoutTable Component
 *
 * Displays the parts list in a sortable, paginated DataTable
 */
export function PartoutTable({ parts, condition }: PartoutTableProps) {
  // Memoize columns to prevent unnecessary re-renders
  const columns = useMemo(() => createColumns(condition), [condition]);

  // Sort parts by total value for the selected condition
  const sortedParts = useMemo(() => {
    return [...parts].sort((a, b) => {
      const aTotal = condition === 'new' ? a.totalNew : a.totalUsed;
      const bTotal = condition === 'new' ? b.totalNew : b.totalUsed;
      return bTotal - aTotal;
    });
  }, [parts, condition]);

  return (
    <DataTable
      columns={columns}
      data={sortedParts}
      searchKey="name"
      searchPlaceholder="Search parts..."
      getRowId={(part) => `${part.partNumber}-${part.colourId}`}
      enableColumnVisibility
      columnDisplayNames={{
        image: 'Image',
        name: 'Name',
        colourName: 'Colour',
        quantity: 'Qty',
        price: 'Price',
        total: 'Total',
        sellThroughRate: 'Sell-Through',
        stockAvailable: 'Stock',
        timesSold: 'Sold',
        cache: 'Cache',
      }}
      initialColumnVisibility={{
        cache: false, // Hide cache indicator by default
      }}
      columnVisibilityStorageKey="partout-table-columns"
    />
  );
}
