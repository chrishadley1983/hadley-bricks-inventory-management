'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, ArrowUpDown, ExternalLink, Trash2, CloudUpload, Link2 } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  // Sale columns
  sold_date: 'Sale Date',
  sold_platform: 'Sale Platform',
  sold_order_id: 'Order ID',
  sold_gross_amount: 'Gross Amount',
  sold_fees_amount: 'Fees',
  sold_net_amount: 'Net Amount',
  sale_profit: 'Sale Profit',
  actions: 'Actions',
};

interface ColumnsProps {
  onDelete?: (id: string) => void;
  onAddToAmazonSync?: (item: InventoryItem) => void;
}

export function getInventoryColumns({ onDelete, onAddToAmazonSync }: ColumnsProps = {}): ColumnDef<InventoryItem>[] {
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
        const item = row.original;

        if (!status) {
          return <Badge variant="outline">Unknown</Badge>;
        }

        // For SOLD items, always show tooltip
        if (status === 'SOLD') {
          const hasAnyOrderData = item.sold_date || item.sold_platform || item.sold_order_id ||
            item.sold_gross_amount != null || item.sold_fees_amount != null || item.sold_net_amount != null;

          const soldBadge = (
            <span className="inline-flex items-center gap-1">
              <Badge variant={STATUS_VARIANTS[status] || 'outline'}>
                {status}
              </Badge>
              {hasAnyOrderData && (
                <Link2 className="h-3.5 w-3.5 text-green-600" />
              )}
            </span>
          );

          const profit = item.sold_net_amount != null && item.cost != null
            ? item.sold_net_amount - item.cost
            : null;

          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">{soldBadge}</span>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="bg-background border shadow-lg p-3 max-w-xs"
                >
                  <div className="space-y-2 text-sm">
                    <div className="font-semibold text-foreground border-b pb-1">Sale Details</div>
                    {!hasAnyOrderData ? (
                      <div className="text-muted-foreground italic py-2">No linked order</div>
                    ) : (
                      <>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Sold:</span>
                          <span className={item.sold_date ? 'text-foreground' : 'text-muted-foreground italic'}>
                            {item.sold_date ? formatDate(item.sold_date) : 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Platform:</span>
                          <span className={item.sold_platform ? 'text-foreground capitalize' : 'text-muted-foreground italic'}>
                            {item.sold_platform || 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Order:</span>
                          <span className={item.sold_order_id ? 'text-foreground font-mono text-xs' : 'text-muted-foreground italic'}>
                            {item.sold_order_id ? `${item.sold_order_id.slice(0, 15)}...` : 'Unavailable'}
                          </span>
                        </div>
                        <div className="border-t pt-2 mt-2">
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Gross:</span>
                            <span className={item.sold_gross_amount != null ? 'text-foreground' : 'text-muted-foreground italic'}>
                              {item.sold_gross_amount != null ? formatCurrency(item.sold_gross_amount) : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Fees:</span>
                            <span className={item.sold_fees_amount != null ? 'text-red-600' : 'text-muted-foreground italic'}>
                              {item.sold_fees_amount != null ? `-${formatCurrency(item.sold_fees_amount)}` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Net:</span>
                            <span className={item.sold_net_amount != null ? 'text-foreground' : 'text-muted-foreground italic'}>
                              {item.sold_net_amount != null ? formatCurrency(item.sold_net_amount) : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Cost:</span>
                            <span className={item.cost != null ? 'text-foreground' : 'text-muted-foreground italic'}>
                              {item.cost != null ? `-${formatCurrency(item.cost)}` : 'Unavailable'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 border-t pt-1 mt-1 font-semibold">
                            <span className="text-muted-foreground">Profit:</span>
                            <span className={profit != null ? (profit >= 0 ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground italic font-normal'}>
                              {profit != null ? formatCurrency(profit) : 'Unavailable'}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }

        // For LISTED items, always show tooltip
        if (status === 'LISTED') {
          const hasAnyListingData = item.listing_date || item.listing_platform || item.listing_value != null;

          const potentialProfit = item.cost != null && item.listing_value != null
            ? item.listing_value - item.cost
            : null;

          const listedBadge = (
            <Badge variant={STATUS_VARIANTS[status] || 'outline'}>
              {status}
            </Badge>
          );

          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">{listedBadge}</span>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="bg-background border shadow-lg p-3 max-w-xs"
                >
                  <div className="space-y-2 text-sm">
                    <div className="font-semibold text-foreground border-b pb-1">Listing Details</div>
                    {!hasAnyListingData ? (
                      <div className="text-muted-foreground italic py-2">No listing data</div>
                    ) : (
                      <>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Listed:</span>
                          <span className={item.listing_date ? 'text-foreground' : 'text-muted-foreground italic'}>
                            {item.listing_date ? formatDate(item.listing_date) : 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Platform:</span>
                          <span className={item.listing_platform ? 'text-foreground capitalize' : 'text-muted-foreground italic'}>
                            {item.listing_platform || 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Price:</span>
                          <span className={item.listing_value != null ? 'text-foreground' : 'text-muted-foreground italic'}>
                            {item.listing_value != null ? formatCurrency(item.listing_value) : 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 border-t pt-1 mt-1">
                          <span className="text-muted-foreground">Potential Profit:</span>
                          <span className={potentialProfit != null ? (potentialProfit >= 0 ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground italic'}>
                            {potentialProfit != null ? formatCurrency(potentialProfit) : 'Unavailable'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }

        // Default badge for other statuses
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
    // Sale columns
    {
      accessorKey: 'sold_date',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Sale Date
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = row.getValue('sold_date') as string | null;
        return formatDate(date);
      },
    },
    {
      accessorKey: 'sold_platform',
      header: 'Sale Platform',
      cell: ({ row }) => {
        const platform = row.getValue('sold_platform') as string | null;
        return platform ? (
          <Badge variant="outline" className="capitalize">{platform}</Badge>
        ) : (
          '-'
        );
      },
    },
    {
      accessorKey: 'sold_order_id',
      header: 'Order ID',
      cell: ({ row }) => {
        const orderId = row.getValue('sold_order_id') as string | null;
        return orderId ? (
          <span className="font-mono text-xs max-w-[120px] truncate block" title={orderId}>
            {orderId}
          </span>
        ) : (
          '-'
        );
      },
    },
    {
      accessorKey: 'sold_gross_amount',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Gross Amount
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const amount = row.getValue('sold_gross_amount') as number | null;
        return amount != null ? formatCurrency(amount) : '-';
      },
    },
    {
      accessorKey: 'sold_fees_amount',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Fees
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const amount = row.getValue('sold_fees_amount') as number | null;
        return amount != null ? (
          <span className="text-red-600">-{formatCurrency(amount)}</span>
        ) : (
          '-'
        );
      },
    },
    {
      accessorKey: 'sold_net_amount',
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className="-ml-4"
          >
            Net Amount
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const amount = row.getValue('sold_net_amount') as number | null;
        return amount != null ? formatCurrency(amount) : '-';
      },
    },
    {
      id: 'sale_profit',
      accessorFn: (row) => {
        const cost = row.cost;
        const netAmount = row.sold_net_amount;
        if (cost != null && netAmount != null) {
          return netAmount - cost;
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
            Sale Profit
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
              {onAddToAmazonSync && item.amazon_asin && (
                <DropdownMenuItem onClick={() => onAddToAmazonSync(item)}>
                  <CloudUpload className="mr-2 h-4 w-4" />
                  Add to Amazon Sync
                </DropdownMenuItem>
              )}
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
