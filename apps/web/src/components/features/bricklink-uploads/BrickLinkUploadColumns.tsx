'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, ArrowUpDown, ExternalLink, Trash2, Edit, Cloud } from 'lucide-react';
import Link from 'next/link';
import type { BrickLinkUpload } from '@/lib/services/bricklink-upload.service';
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

interface ColumnsProps {
  onDelete?: (id: string) => void;
}

/**
 * Calculate profit (selling price - cost)
 */
function calculateProfit(sellingPrice: number, cost: number | null): number {
  if (cost === null || cost === 0) return 0;
  return sellingPrice - cost;
}

/**
 * Calculate profit margin as percentage of selling price
 */
function calculateProfitMargin(sellingPrice: number, cost: number | null): number {
  if (cost === null || cost === 0 || sellingPrice === 0) return 0;
  return ((sellingPrice - cost) / sellingPrice) * 100;
}

/**
 * Format condition code to display text
 */
function formatCondition(condition: string | null): string {
  if (!condition) return '-';
  return condition === 'N' ? 'New' : 'Used';
}

export function getBrickLinkUploadColumns({
  onDelete,
}: ColumnsProps = {}): ColumnDef<BrickLinkUpload>[] {
  return [
    {
      accessorKey: 'upload_date',
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
        const date = row.getValue('upload_date') as string;
        const isSynced = row.original.synced_from_bricqer;
        return (
          <Link
            href={`/bricklink-uploads/${row.original.id}`}
            className="font-medium text-primary hover:underline flex items-center gap-1"
          >
            {formatDate(date)}
            {isSynced && (
              <span title="Synced from Bricqer">
                <Cloud className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
          </Link>
        );
      },
    },
    {
      accessorKey: 'total_quantity',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Parts
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const qty = row.getValue('total_quantity') as number;
        return <span className="font-mono">{qty.toLocaleString()}</span>;
      },
    },
    {
      accessorKey: 'selling_price',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Value
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const price = row.getValue('selling_price') as number;
        return <span className="font-medium">{formatCurrency(price)}</span>;
      },
    },
    {
      accessorKey: 'cost',
      header: 'Cost',
      cell: ({ row }) => {
        const cost = row.getValue('cost') as number | null;
        return cost ? formatCurrency(cost) : '-';
      },
    },
    {
      id: 'margin',
      header: 'Margin',
      cell: ({ row }) => {
        const sellingPrice = row.original.selling_price;
        const cost = row.original.cost;
        const profit = calculateProfit(sellingPrice, cost);
        const profitMargin = calculateProfitMargin(sellingPrice, cost);

        if (cost === null || cost === 0) {
          return '-';
        }

        const isPositive = profit > 0;

        return (
          <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
            {formatCurrency(profit)} ({profitMargin.toFixed(0)}%)
          </span>
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
      accessorKey: 'lots',
      header: 'Lots',
      cell: ({ row }) => {
        const lots = row.getValue('lots') as number | null;
        return lots ? <span className="font-mono">{lots}</span> : '-';
      },
    },
    {
      accessorKey: 'condition',
      header: 'Cond.',
      cell: ({ row }) => {
        const condition = row.getValue('condition') as string | null;
        return (
          <Badge variant={condition === 'N' ? 'default' : 'secondary'}>
            {formatCondition(condition)}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'notes',
      header: 'Notes',
      cell: ({ row }) => {
        const notes = row.getValue('notes') as string | null;
        if (!notes) return '-';
        return (
          <span className="max-w-[150px] truncate block text-muted-foreground" title={notes}>
            {notes}
          </span>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const upload = row.original;

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
                <Link href={`/bricklink-uploads/${upload.id}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/bricklink-uploads/${upload.id}/edit`}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {onDelete && (
                <DropdownMenuItem className="text-destructive" onClick={() => onDelete(upload.id)}>
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
