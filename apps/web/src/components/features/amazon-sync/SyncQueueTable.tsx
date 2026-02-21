'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Trash2, ArrowUpDown } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRemoveFromSyncQueue } from '@/hooks/use-amazon-sync';
import type { QueueItemWithDetails } from '@/lib/amazon/amazon-sync.types';
import { formatCurrency } from '@/lib/utils';

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

function getColumns(onRemove: (id: string) => void): ColumnDef<QueueItemWithDetails>[] {
  return [
    {
      accessorKey: 'inventoryItem.set_number',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Set Number
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        return <span className="font-medium">{row.original.inventoryItem.set_number}</span>;
      },
    },
    {
      accessorKey: 'inventoryItem.item_name',
      header: 'Name',
      cell: ({ row }) => {
        const name = row.original.inventoryItem.item_name;
        return (
          <span className="max-w-[200px] truncate" title={name || ''}>
            {name || '-'}
          </span>
        );
      },
    },
    {
      accessorKey: 'asin',
      header: 'ASIN',
      cell: ({ row }) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{row.original.asin}</code>
      ),
    },
    {
      accessorKey: 'amazon_sku',
      header: 'Amazon SKU',
      cell: ({ row }) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          {row.original.amazon_sku || '-'}
        </code>
      ),
    },
    {
      accessorKey: 'local_price',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Local Price
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => formatCurrency(row.original.local_price),
    },
    {
      accessorKey: 'amazon_price',
      header: 'Amazon Price',
      cell: ({ row }) => {
        const price = row.original.amazon_price;
        return price !== null ? (
          formatCurrency(price)
        ) : (
          <span className="text-muted-foreground">N/A</span>
        );
      },
    },
    {
      accessorKey: 'priceDifference',
      header: 'Price Diff',
      cell: ({ row }) => {
        const diff = row.original.priceDifference;
        if (diff === null) return <span className="text-muted-foreground">-</span>;

        const isPositive = diff > 0;
        const isNegative = diff < 0;

        return (
          <Badge
            variant={isPositive ? 'destructive' : isNegative ? 'default' : 'secondary'}
            className={isNegative ? 'bg-green-500 hover:bg-green-600' : ''}
          >
            {isPositive ? '+' : ''}
            {formatCurrency(diff)}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'local_quantity',
      header: 'Local Qty',
      cell: ({ row }) => row.original.local_quantity,
    },
    {
      accessorKey: 'amazon_quantity',
      header: 'Amazon Qty',
      cell: ({ row }) => {
        const qty = row.original.amazon_quantity;
        return qty !== null ? qty : <span className="text-muted-foreground">N/A</span>;
      },
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => {
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemove(row.original.id)}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        );
      },
    },
  ];
}

// ============================================================================
// COMPONENT
// ============================================================================

interface SyncQueueTableProps {
  items: QueueItemWithDetails[];
  isLoading?: boolean;
}

export function SyncQueueTable({ items, isLoading }: SyncQueueTableProps) {
  const [removeId, setRemoveId] = useState<string | null>(null);
  const removeMutation = useRemoveFromSyncQueue();

  const handleRemove = (id: string) => {
    setRemoveId(id);
  };

  const handleConfirmRemove = async () => {
    if (!removeId) return;

    try {
      await removeMutation.mutateAsync(removeId);
    } finally {
      setRemoveId(null);
    }
  };

  const columns = getColumns(handleRemove);

  return (
    <>
      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        enableRowSelection={false}
        enableColumnVisibility
        columnDisplayNames={{
          'inventoryItem.set_number': 'Set Number',
          'inventoryItem.item_name': 'Name',
          asin: 'ASIN',
          amazon_sku: 'Amazon SKU',
          local_price: 'Local Price',
          amazon_price: 'Amazon Price',
          priceDifference: 'Price Diff',
          local_quantity: 'Local Qty',
          amazon_quantity: 'Amazon Qty',
        }}
        initialColumnVisibility={{
          amazon_sku: false,
        }}
      />

      <Dialog open={!!removeId} onOpenChange={() => setRemoveId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from Queue</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this item from the sync queue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRemove}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
