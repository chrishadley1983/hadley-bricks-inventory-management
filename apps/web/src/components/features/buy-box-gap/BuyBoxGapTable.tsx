'use client';

import { useState, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, DollarSign, ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RepriceDialog } from './RepriceDialog';
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

function actionBadge(profitAtBuyBox: BuyBoxGapRow['profitAtBuyBox']): {
  text: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
} {
  if (!profitAtBuyBox)
    return { text: 'No COG', variant: 'secondary', className: 'bg-slate-100 text-slate-600' };
  if (profitAtBuyBox.profitMarginPercent >= 15)
    return { text: 'Match BB', variant: 'default', className: 'bg-green-100 text-green-800' };
  if (profitAtBuyBox.profitMarginPercent >= 5)
    return { text: 'Review', variant: 'default', className: 'bg-amber-100 text-amber-800' };
  if (profitAtBuyBox.profitMarginPercent >= 0)
    return { text: 'Marginal', variant: 'destructive', className: 'bg-red-100 text-red-800' };
  return { text: 'Loss', variant: 'destructive', className: 'bg-red-100 text-red-800' };
}

/**
 * Round price down to nearest .49 or .99 below the buy box
 */
export function suggestPrice(buyBoxPrice: number): number {
  const pence = Math.round(buyBoxPrice * 100);
  const base = Math.floor(pence / 100) * 100;
  const candidates: number[] = [];

  if (base + 49 < pence) candidates.push(base + 49);
  if (base + 99 < pence) candidates.push(base + 99);
  if (base - 100 + 49 < pence) candidates.push(base - 100 + 49);
  if (base - 100 + 99 < pence) candidates.push(base - 100 + 99);

  if (candidates.length === 0) return Math.round((buyBoxPrice - 0.01) * 100) / 100;
  return Math.max(...candidates) / 100;
}

function getColumns(onReprice: (item: BuyBoxGapRow) => void): ColumnDef<BuyBoxGapRow>[] {
  return [
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
      accessorKey: 'buyBoxPrice',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Buy Box
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div>
          <span className="font-semibold tabular-nums">{formatGBP(row.original.buyBoxPrice)}</span>
          {row.original.priceSource === 'was90d' && (
            <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-200">
              Was90d
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'gapAbsolute',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Gap
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="tabular-nums">
          <span className={row.original.gapAbsolute > 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
            {formatGBP(row.original.gapAbsolute)}
          </span>
          <p className="text-xs text-muted-foreground">{formatPct(row.original.gapPercent)}</p>
        </div>
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
      id: 'marginNow',
      accessorFn: (row) => row.profitAtYourPrice?.profitMarginPercent ?? -999,
      header: 'Margin Now',
      cell: ({ row }) => {
        const margin = row.original.profitAtYourPrice?.profitMarginPercent ?? null;
        return <span className={`tabular-nums font-medium ${profitColor(margin)}`}>{formatPct(margin)}</span>;
      },
    },
    {
      id: 'marginAtBB',
      accessorFn: (row) => row.profitAtBuyBox?.profitMarginPercent ?? -999,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Margin @ BB
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const margin = row.original.profitAtBuyBox?.profitMarginPercent ?? null;
        const profit = row.original.profitAtBuyBox?.totalProfit ?? null;
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
      id: 'action',
      header: 'Action',
      cell: ({ row }) => {
        const badge = actionBadge(row.original.profitAtBuyBox);
        return (
          <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
            {badge.text}
          </Badge>
        );
      },
    },
    {
      id: 'reprice',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onReprice(row.original)}
        >
          <DollarSign className="h-3 w-3 mr-1" />
          Reprice
        </Button>
      ),
    },
  ];
}

interface BuyBoxGapTableProps {
  items: BuyBoxGapRow[];
  isLoading?: boolean;
  onRepriceSuccess?: () => void;
}

export function BuyBoxGapTable({ items, isLoading, onRepriceSuccess }: BuyBoxGapTableProps) {
  const [repriceItem, setRepriceItem] = useState<BuyBoxGapRow | null>(null);

  const columns = useMemo(() => getColumns(setRepriceItem), []);

  return (
    <>
      <DataTable
        columns={columns}
        data={items}
        searchKey="name"
        searchPlaceholder="Search items..."
        isLoading={isLoading}
        getRowId={(row) => row.asin}
      />
      <RepriceDialog
        item={repriceItem}
        onClose={() => setRepriceItem(null)}
        onSuccess={() => {
          setRepriceItem(null);
          onRepriceSuccess?.();
        }}
      />
    </>
  );
}
