'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, Database, ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
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
 * Sortable column header.
 *
 * The old header always rendered the same neutral up/down glyph, so nothing on screen
 * said which column was driving the order or in which direction. Now the active column
 * shows a solid arrow and is emphasised; everything else stays muted.
 */
function SortableHeader({
  column,
  label,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any;
  label: string;
}) {
  const sorted = column.getIsSorted() as 'asc' | 'desc' | false;
  const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;

  return (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      className={`-ml-4 ${sorted ? 'font-semibold text-foreground' : ''}`}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
    >
      {label}
      <Icon className={`ml-2 h-4 w-4 ${sorted ? 'text-foreground' : 'text-muted-foreground/60'}`} />
    </Button>
  );
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
      header: ({ column }) => <SortableHeader column={column} label={'Name'} />,
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
      cell: ({ row }) => <span className="text-sm">{row.original.colourName}</span>,
    },
    {
      accessorKey: 'quantity',
      header: ({ column }) => <SortableHeader column={column} label={'Qty'} />,
      cell: ({ row }) => <span className="font-medium">{row.original.quantity}</span>,
    },
    {
      id: 'price',
      accessorFn: (row) => (condition === 'new' ? row.priceNew : row.priceUsed),
      header: ({ column }) => <SortableHeader column={column} label={'Price'} />,
      cell: ({ row }) =>
        formatCurrency(condition === 'new' ? row.original.priceNew : row.original.priceUsed),
    },
    {
      id: 'total',
      accessorFn: (row) => (condition === 'new' ? row.totalNew : row.totalUsed),
      header: ({ column }) => <SortableHeader column={column} label={'Total'} />,
      cell: ({ row }) => (
        <span className={`font-medium ${condition === 'new' ? 'text-green-700' : 'text-blue-700'}`}>
          {formatCurrency(condition === 'new' ? row.original.totalNew : row.original.totalUsed)}
        </span>
      ),
    },
    {
      id: 'stockAvailable',
      accessorFn: (row) => (condition === 'new' ? row.stockAvailableNew : row.stockAvailableUsed),
      header: ({ column }) => <SortableHeader column={column} label={'Stock qty'} />,
      cell: ({ row }) =>
        (condition === 'new' ? row.original.stockAvailableNew : row.original.stockAvailableUsed) ??
        '-',
    },
    {
      id: 'timesSold',
      accessorFn: (row) => (condition === 'new' ? row.timesSoldNew : row.timesSoldUsed),
      header: ({ column }) => <SortableHeader column={column} label={'Sold qty'} />,
      cell: ({ row }) =>
        (condition === 'new' ? row.original.timesSoldNew : row.original.timesSoldUsed) ?? '-',
    },
    {
      // Quantity-basis STR — the figure the gates, magnet test and capture curve all use,
      // and now the same basis as the Stock qty / Sold qty columns beside it, so the row
      // reconciles: Sold qty / Stock qty = this. (It previously sat next to LOT counts,
      // which is how njo0658 read "Stock 12 / Sold 6" against an STR of 0.02 — 12 listings
      // holding 333 pieces.) The legacy lots-basis percentage column has been removed.
      id: 'strQty',
      accessorFn: (row) => (condition === 'new' ? row.strQtyNew : row.strQtyUsed),
      header: ({ column }) => <SortableHeader column={column} label={'STR (qty)'} />,
      cell: ({ row }) => {
        const str = condition === 'new' ? row.original.strQtyNew : row.original.strQtyUsed;
        return str == null ? '-' : str.toFixed(2);
      },
    },
    {
      id: 'worldSupply',
      accessorFn: (row) => (condition === 'new' ? row.worldSupplyLotsNew : row.worldSupplyLotsUsed),
      header: ({ column }) => <SortableHeader column={column} label={'World lots'} />,
      cell: ({ row }) =>
        (condition === 'new'
          ? row.original.worldSupplyLotsNew
          : row.original.worldSupplyLotsUsed) ?? '-',
    },
    {
      id: 'overlap',
      accessorFn: (row) => (condition === 'new' ? row.overlapNew : row.overlapUsed) ?? '',
      header: 'Overlap',
      cell: ({ row }) => {
        const tag = condition === 'new' ? row.original.overlapNew : row.original.overlapUsed;
        const ourQty = condition === 'new' ? row.original.ourQtyNew : row.original.ourQtyUsed;
        if (!tag) return <span className="text-muted-foreground">-</span>;
        return (
          <span title={ourQty != null ? `We hold ${ourQty}` : undefined}>
            {tag.replace('RESTOCK_', 'R-')}
          </span>
        );
      },
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
        strQty: 'STR (qty)',
        stockAvailable: 'Stock qty',
        timesSold: 'Sold qty',
        worldSupply: 'World lots',
        overlap: 'Overlap',
        cache: 'Cache',
      }}
      initialColumnVisibility={{
        cache: false, // Hide cache indicator by default
        // The legacy lots-basis percentage is superseded by STR (qty) but kept
        // available behind the column picker rather than removed outright.
      }}
      columnVisibilityStorageKey="partout-table-columns"
    />
  );
}
