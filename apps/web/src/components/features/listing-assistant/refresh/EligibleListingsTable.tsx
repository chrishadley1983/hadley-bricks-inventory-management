'use client';

import { useMemo, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { ExternalLink, Calendar } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EngagementBadge } from './EngagementPopover';
import type { EligibleListing } from '@/lib/ebay/listing-refresh.types';

interface EligibleListingsTableProps {
  listings: EligibleListing[];
  isLoading?: boolean;
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
}

/**
 * Table displaying listings eligible for refresh with engagement stats
 */
export function EligibleListingsTable({
  listings,
  isLoading = false,
  selectedIds: _selectedIds,
  onSelectionChange,
}: EligibleListingsTableProps) {
  const handleSelectionChange = useCallback(
    (rows: EligibleListing[]) => {
      onSelectionChange(rows.map((r) => r.itemId));
    },
    [onSelectionChange]
  );

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP',
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(date));
  };

  const getAgeColor = (days: number) => {
    if (days >= 180) return 'text-red-500';
    if (days >= 120) return 'text-amber-500';
    return 'text-muted-foreground';
  };

  const columns: ColumnDef<EligibleListing>[] = useMemo(
    () => [
      {
        accessorKey: 'title',
        header: 'Title',
        cell: ({ row }) => (
          <div className="max-w-md">
            <p className="font-medium truncate">{row.original.title}</p>
            <div className="flex items-center gap-2 mt-1">
              {row.original.sku && (
                <Badge variant="outline" className="text-xs">
                  SKU: {row.original.sku}
                </Badge>
              )}
              {row.original.categoryName && (
                <span className="text-xs text-muted-foreground truncate">
                  {row.original.categoryName}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'price',
        header: 'Price',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{formatCurrency(row.original.price, row.original.currency)}</p>
            {row.original.bestOfferEnabled && (
              <Badge variant="secondary" className="text-xs mt-1">
                Best Offer
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'listingAge',
        header: 'Age',
        cell: ({ row }) => (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1">
                  <Calendar className={`h-4 w-4 ${getAgeColor(row.original.listingAge)}`} />
                  <span className={`font-medium ${getAgeColor(row.original.listingAge)}`}>
                    {row.original.listingAge}d
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                Listed: {formatDate(row.original.listingStartDate)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ),
      },
      {
        accessorKey: 'watchers',
        header: 'Engagement',
        cell: ({ row }) => <EngagementBadge listing={row.original} />,
      },
      {
        accessorKey: 'quantity',
        header: 'Qty',
        cell: ({ row }) => (
          <span>
            {row.original.quantityAvailable}
            {row.original.quantity !== row.original.quantityAvailable && (
              <span className="text-muted-foreground">/{row.original.quantity}</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'condition',
        header: 'Condition',
        cell: ({ row }) =>
          row.original.condition && (
            <Badge variant="outline">{row.original.condition}</Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.viewItemUrl && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => window.open(row.original.viewItemUrl!, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View on eBay</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        ),
        enableSorting: false,
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={listings}
      isLoading={isLoading}
      enableRowSelection
      onRowSelectionChange={handleSelectionChange}
      getRowId={(row) => row.itemId}
      searchKey="title"
      searchPlaceholder="Search listings..."
    />
  );
}
