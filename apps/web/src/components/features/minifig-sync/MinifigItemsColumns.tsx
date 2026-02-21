'use client';

import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MinifigSyncItem } from '@/lib/minifig-sync/types';

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  NOT_LISTED: 'secondary',
  STAGED: 'default',
  PUBLISHING: 'default',
  REVIEWING: 'default',
  PUBLISHED: 'outline',
  SOLD_EBAY: 'destructive',
  SOLD_EBAY_PENDING_REMOVAL: 'destructive',
  SOLD_BRICQER: 'destructive',
  SOLD_BRICQER_PENDING_REMOVAL: 'destructive',
  ENDED: 'secondary',
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function formatCurrency(value: number | null): string {
  if (value == null) return '-';
  return `\u00A3${value.toFixed(2)}`;
}

export const MINIFIG_COLUMN_DISPLAY_NAMES: Record<string, string> = {
  bricqer_image_url: 'Image',
  name: 'Name',
  bricklink_id: 'BrickLink ID',
  bricqer_price: 'Bricqer Price',
  ebay_avg_sold_price: 'Avg Sold',
  ebay_sold_count: 'Sold Count',
  ebay_sell_through_rate: 'Sell-Through %',
  meets_threshold: 'Threshold',
  recommended_price: 'Recommended',
  listing_status: 'Status',
};

export function getMinifigItemsColumns(): ColumnDef<MinifigSyncItem>[] {
  return [
    {
      accessorKey: 'bricqer_image_url',
      header: 'Image',
      enableSorting: false,
      cell: ({ row }) => {
        const url = row.getValue('bricqer_image_url') as string | null;
        return url ? (
          <img
            src={url}
            alt={row.original.name || 'Minifig'}
            className="h-10 w-10 rounded object-contain"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-10 rounded bg-muted" />
        );
      },
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
      cell: ({ row }) => {
        const name = row.getValue('name') as string;
        return <span className="max-w-[250px] truncate block">{name}</span>;
      },
    },
    {
      accessorKey: 'bricklink_id',
      header: 'BrickLink ID',
      cell: ({ row }) => {
        const id = row.getValue('bricklink_id') as string | null;
        if (!id) return '-';
        return (
          <a
            href={`https://www.bricklink.com/v2/catalog/catalogitem.page?M=${id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-sm"
          >
            {id}
            <ExternalLink className="h-3 w-3" />
          </a>
        );
      },
    },
    {
      accessorKey: 'bricqer_price',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Bricqer Price
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => formatCurrency(row.getValue('bricqer_price') as number | null),
    },
    {
      accessorKey: 'ebay_avg_sold_price',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Avg Sold
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => formatCurrency(row.getValue('ebay_avg_sold_price') as number | null),
    },
    {
      accessorKey: 'ebay_sold_count',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Sold Count
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const count = row.getValue('ebay_sold_count') as number | null;
        return count != null ? count : '-';
      },
    },
    {
      accessorKey: 'ebay_sell_through_rate',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Sell-Through %
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const rate = row.getValue('ebay_sell_through_rate') as number | null;
        return rate != null ? `${rate.toFixed(1)}%` : '-';
      },
    },
    {
      accessorKey: 'meets_threshold',
      header: 'Threshold',
      cell: ({ row }) => {
        const meets = row.getValue('meets_threshold') as boolean | null;
        if (meets == null) return <Badge variant="outline">-</Badge>;
        return meets ? (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
            Yes
          </Badge>
        ) : (
          <Badge variant="destructive">No</Badge>
        );
      },
    },
    {
      accessorKey: 'recommended_price',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Recommended
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => formatCurrency(row.getValue('recommended_price') as number | null),
    },
    {
      accessorKey: 'listing_status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('listing_status') as string | null;
        if (!status) return <Badge variant="outline">Unknown</Badge>;
        return <Badge variant={STATUS_VARIANTS[status] || 'outline'}>{formatStatus(status)}</Badge>;
      },
    },
  ];
}
