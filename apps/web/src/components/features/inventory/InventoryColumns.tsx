'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, ArrowUpDown, ExternalLink, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { InventoryItem } from '@hadley-bricks/database';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCurrency, formatDate } from '@/lib/utils';

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  'NOT YET RECEIVED': 'secondary',
  BACKLOG: 'default',
  LISTED: 'outline',
  SOLD: 'destructive',
};

export const COLUMN_DISPLAY_NAMES: Record<string, string> = {
  set_number: 'Set Number',
  item_name: 'Item Name',
  condition: 'Condition',
  status: 'Status',
  sku: 'SKU',
  source: 'Source',
  cost: 'Cost',
  listing_value: 'List Price',
  potential_profit: 'Potential Profit',
  storage_location: 'Location',
  purchase_date: 'Purchase Date',
  listing_date: 'Listing Date',
  listing_platform: 'Listing Platform',
  amazon_asin: 'Amazon ASIN',
  linked_lot: 'Linked Purchase',
  notes: 'Notes',
  created_at: 'Created',
  updated_at: 'Last Updated',
  actions: 'Actions',
};

interface ColumnsProps {
  onDelete?: (id: string) => void;
}

export function getInventoryColumns({ onDelete }: ColumnsProps = {}): ColumnDef<InventoryItem>[] {
  return [
    {
      accessorKey: 'set_number',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Set Number
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const setNumber = row.getValue('set_number') as string;
        return (
          <Link
            href={`/inventory/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {setNumber}
          </Link>
        );
      },
    },
    {
      accessorKey: 'item_name',
      header: 'Item Name',
      cell: ({ row }) => {
        const name = row.getValue('item_name') as string | null;
        return <span className="max-w-[200px] truncate">{name || '-'}</span>;
      },
    },
    {
      accessorKey: 'condition',
      header: 'Condition',
      cell: ({ row }) => {
        const condition = row.getValue('condition') as string | null;
        return condition ? (
          <Badge variant={condition === 'New' ? 'default' : 'secondary'}>{condition}</Badge>
        ) : (
          '-'
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string | null;
        if (!status) {
          return <Badge variant="outline">Unknown</Badge>;
        }
        return (
          <Badge variant={STATUS_VARIANTS[status] || 'outline'}>
            {status.replace('NOT YET RECEIVED', 'Pending')}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'sku',
      header: 'SKU',
      cell: ({ row }) => {
        const sku = row.getValue('sku') as string | null;
        return <span className="font-mono text-sm">{sku || '-'}</span>;
      },
    },
    {
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => {
        const source = row.getValue('source') as string | null;
        return <span className="max-w-[100px] truncate">{source || '-'}</span>;
      },
    },
    {
      accessorKey: 'cost',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Cost
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const cost = row.getValue('cost') as number | null;
        return cost ? formatCurrency(cost) : '-';
      },
    },
    {
      accessorKey: 'listing_value',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            List Price
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const value = row.getValue('listing_value') as number | null;
        return value ? formatCurrency(value) : '-';
      },
    },
    {
      id: 'potential_profit',
      accessorFn: (row) => {
        const cost = row.cost;
        const listingValue = row.listing_value;
        if (cost != null && listingValue != null) {
          return listingValue - cost;
        }
        return null;
      },
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Potential Profit
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ getValue }) => {
        const profit = getValue() as number | null;
        if (profit == null) return '-';
        const isPositive = profit >= 0;
        return (
          <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
            {formatCurrency(profit)}
          </span>
        );
      },
    },
    {
      accessorKey: 'storage_location',
      header: 'Location',
      cell: ({ row }) => {
        const location = row.getValue('storage_location') as string | null;
        return <span className="max-w-[100px] truncate">{location || '-'}</span>;
      },
    },
    {
      accessorKey: 'purchase_date',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Purchase Date
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = row.getValue('purchase_date') as string | null;
        return formatDate(date);
      },
    },
    {
      accessorKey: 'listing_date',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Listing Date
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = row.getValue('listing_date') as string | null;
        return formatDate(date);
      },
    },
    {
      accessorKey: 'listing_platform',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Listing Platform
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const platform = row.getValue('listing_platform') as string | null;
        return platform ? (
          <Badge variant="outline">{platform}</Badge>
        ) : (
          '-'
        );
      },
    },
    {
      accessorKey: 'amazon_asin',
      header: 'Amazon ASIN',
      cell: ({ row }) => {
        const asin = row.getValue('amazon_asin') as string | null;
        return <span className="font-mono text-sm">{asin || '-'}</span>;
      },
    },
    {
      accessorKey: 'linked_lot',
      header: 'Linked Purchase',
      cell: ({ row }) => {
        const lot = row.getValue('linked_lot') as string | null;
        return <span className="max-w-[100px] truncate">{lot || '-'}</span>;
      },
    },
    {
      accessorKey: 'notes',
      header: 'Notes',
      cell: ({ row }) => {
        const notes = row.getValue('notes') as string | null;
        return (
          <span className="max-w-[200px] truncate" title={notes || undefined}>
            {notes || '-'}
          </span>
        );
      },
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Created
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = row.getValue('created_at') as string | null;
        return formatDate(date);
      },
    },
    {
      accessorKey: 'updated_at',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Last Updated
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = row.getValue('updated_at') as string | null;
        return formatDate(date);
      },
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => {
        const item = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={`/inventory/${item.id}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {onDelete && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
