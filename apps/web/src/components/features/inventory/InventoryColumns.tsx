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
  'IN STOCK': 'default',
  LISTED: 'outline',
  SOLD: 'destructive',
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
        const status = row.getValue('status') as string;
        return (
          <Badge variant={STATUS_VARIANTS[status] || 'outline'}>
            {status.replace('NOT YET RECEIVED', 'Pending')}
          </Badge>
        );
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
      header: 'List Price',
      cell: ({ row }) => {
        const value = row.getValue('listing_value') as number | null;
        return value ? formatCurrency(value) : '-';
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
            Purchased
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
      id: 'actions',
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
