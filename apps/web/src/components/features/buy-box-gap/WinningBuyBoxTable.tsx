'use client';

import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import type { BuyBoxGapRow } from '@/app/api/reports/buy-box-gap/route';

function formatGBP(n: number | null | undefined): string {
  if (n === null || n === undefined) return '\u2014';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
}

function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '\u2014';
  return `${n.toFixed(1)}%`;
}

function formatRank(n: number | null | undefined): string {
  if (n === null || n === undefined) return '\u2014';
  return `#${new Intl.NumberFormat('en-GB').format(n)}`;
}

function profitColor(margin: number | null | undefined): string {
  if (margin === null || margin === undefined) return 'text-muted-foreground';
  if (margin >= 15) return 'text-green-600';
  if (margin >= 5) return 'text-amber-600';
  return 'text-red-600';
}

const columns: ColumnDef<BuyBoxGapRow>[] = [
  {
    accessorKey: 'asin',
    header: 'ASIN',
    cell: ({ row }) => (
      <a
        href={`https://www.amazon.co.uk/dp/${row.original.asin}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-blue-600 hover:underline flex items-center gap-1"
      >
        {row.original.asin}
        <ExternalLink className="h-3 w-3" />
      </a>
    ),
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        className="-ml-4"
      >
        Item
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <div className="max-w-[250px]">
        <p className="text-sm truncate">{row.original.name}</p>
        {row.original.setNumber && (
          <p className="text-xs text-muted-foreground">{row.original.setNumber}</p>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'yourPrice',
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        className="-ml-4"
      >
        Your Price
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums">{formatGBP(row.original.yourPrice)}</span>
    ),
  },
  {
    accessorKey: 'inventoryCost',
    header: 'COG',
    cell: ({ row }) => (
      <div className="tabular-nums">
        <span>{formatGBP(row.original.inventoryCost)}</span>
        {row.original.costItemCount > 1 && (
          <p className="text-xs text-muted-foreground">avg of {row.original.costItemCount}</p>
        )}
      </div>
    ),
  },
  {
    id: 'margin',
    accessorFn: (row) => row.profitAtYourPrice?.profitMarginPercent ?? -999,
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        className="-ml-4"
      >
        Margin
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const margin = row.original.profitAtYourPrice?.profitMarginPercent ?? null;
      const profit = row.original.profitAtYourPrice?.totalProfit ?? null;
      return (
        <div className="tabular-nums">
          <span className={`font-semibold ${profitColor(margin)}`}>{formatPct(margin)}</span>
          {profit !== null && (
            <p className="text-xs text-muted-foreground">{formatGBP(profit)}</p>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'yourQty',
    header: 'Qty',
    cell: ({ row }) => <span className="tabular-nums">{row.original.yourQty}</span>,
  },
  {
    accessorKey: 'salesRank',
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        className="-ml-4"
      >
        Rank
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">{formatRank(row.original.salesRank)}</span>
    ),
  },
  {
    accessorKey: 'offerCount',
    header: 'Offers',
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.offerCount ?? '\u2014'}</span>
    ),
  },
  {
    accessorKey: 'snapshotDate',
    header: 'Data',
    cell: ({ row }) => {
      const date = row.original.snapshotDate;
      if (!date) return <span className="text-xs text-muted-foreground">{'\u2014'}</span>;
      const daysAgo = Math.floor(
        (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
      );
      const isStale = daysAgo > 3;
      return (
        <span className={`text-xs tabular-nums ${isStale ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
          {daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d' : `${daysAgo}d`}
        </span>
      );
    },
  },
];

interface WinningBuyBoxTableProps {
  items: BuyBoxGapRow[];
  isLoading?: boolean;
}

export function WinningBuyBoxTable({ items, isLoading }: WinningBuyBoxTableProps) {
  const cols = useMemo(() => columns, []);

  return (
    <DataTable
      columns={cols}
      data={items}
      searchKey="name"
      searchPlaceholder="Search items..."
      isLoading={isLoading}
      getRowId={(row) => row.asin}
    />
  );
}
