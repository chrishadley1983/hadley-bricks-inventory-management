'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, ArrowUpDown, ExternalLink, Trash2, Edit } from 'lucide-react';
import Link from 'next/link';
import type { Purchase } from '@hadley-bricks/database';
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

/**
 * Human-readable display names for purchase columns
 */
export const COLUMN_DISPLAY_NAMES: Record<string, string> = {
  purchase_date: 'Date',
  source: 'Source',
  short_description: 'Description',
  cost: 'Cost',
  payment_method: 'Payment',
  description: 'Notes',
  reference: 'Reference',
  created_at: 'Created',
};

interface ColumnsProps {
  onDelete?: (id: string) => void;
}

export function getPurchaseColumns({ onDelete }: ColumnsProps = {}): ColumnDef<Purchase>[] {
  return [
    {
      accessorKey: 'purchase_date',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Date
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = row.getValue('purchase_date') as string;
        return (
          <Link
            href={`/purchases/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {formatDate(date)}
          </Link>
        );
      },
    },
    {
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => {
        const source = row.getValue('source') as string | null;
        return source ? <Badge variant="outline">{source}</Badge> : '-';
      },
    },
    {
      accessorKey: 'short_description',
      header: 'Description',
      cell: ({ row }) => {
        const description = row.getValue('short_description') as string;
        return <span className="max-w-[250px] truncate block">{description}</span>;
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
        const cost = row.getValue('cost') as number;
        return <span className="font-medium">{formatCurrency(cost)}</span>;
      },
    },
    {
      accessorKey: 'payment_method',
      header: 'Payment',
      cell: ({ row }) => {
        const method = row.getValue('payment_method') as string | null;
        return method || '-';
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const purchase = row.original;

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
                <Link href={`/purchases/${purchase.id}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/purchases/${purchase.id}/edit`}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {onDelete && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onDelete(purchase.id)}
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
