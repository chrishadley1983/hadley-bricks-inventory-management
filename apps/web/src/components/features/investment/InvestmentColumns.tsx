'use client';

import { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { InvestmentSet } from '@/lib/api/investment';

const RETIREMENT_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  available: 'default',
  retiring_soon: 'destructive',
  retired: 'secondary',
};

const RETIREMENT_STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  retiring_soon: 'Retiring Soon',
  retired: 'Retired',
};

const CONFIDENCE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  confirmed: 'default',
  likely: 'secondary',
  speculative: 'outline',
};

export const COLUMN_DISPLAY_NAMES: Record<string, string> = {
  image: 'Image',
  set_number: 'Set Number',
  set_name: 'Name',
  theme: 'Theme',
  subtheme: 'Subtheme',
  year_from: 'Year',
  uk_retail_price: 'RRP (GBP)',
  buy_box_price: 'Buy Box (GBP)',
  sales_rank: 'Sales Rank',
  offer_count: 'Offers',
  retirement_status: 'Retirement Status',
  expected_retirement_date: 'Expected Retirement',
  retirement_confidence: 'Confidence',
  pieces: 'Pieces',
  minifigs: 'Minifigs',
  exclusivity_tier: 'Exclusivity',
  is_licensed: 'Licensed',
};

export function getInvestmentColumns(): ColumnDef<InvestmentSet>[] {
  return [
    {
      id: 'image',
      header: '',
      cell: ({ row }) => {
        const imageUrl = row.original.image_url;
        if (!imageUrl) return <div className="h-10 w-10 rounded bg-muted" />;
        return (
          <img
            src={imageUrl}
            alt={row.original.set_name || row.original.set_number}
            className="h-10 w-10 rounded object-contain"
            loading="lazy"
          />
        );
      },
      enableSorting: false,
      size: 56,
    },
    {
      accessorKey: 'set_number',
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
      cell: ({ row }) => (
        <Link
          href={`/investment/${encodeURIComponent(row.getValue('set_number') as string)}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.getValue('set_number')}
        </Link>
      ),
    },
    {
      accessorKey: 'set_name',
      header: 'Name',
      cell: ({ row }) => {
        const name = row.getValue('set_name') as string | null;
        return <span className="max-w-[250px] truncate block">{name || '-'}</span>;
      },
    },
    {
      accessorKey: 'theme',
      header: 'Theme',
      cell: ({ row }) => {
        const theme = row.getValue('theme') as string | null;
        return theme ? <Badge variant="outline">{theme}</Badge> : '-';
      },
    },
    {
      accessorKey: 'subtheme',
      header: 'Subtheme',
      cell: ({ row }) => {
        const subtheme = row.getValue('subtheme') as string | null;
        return subtheme || '-';
      },
    },
    {
      accessorKey: 'year_from',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Year
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => row.getValue('year_from') ?? '-',
    },
    {
      accessorKey: 'uk_retail_price',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          RRP (GBP)
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const price = row.getValue('uk_retail_price') as number | null;
        return price != null ? formatCurrency(price) : '-';
      },
    },
    {
      accessorKey: 'buy_box_price',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Buy Box (GBP)
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const price = row.original.buy_box_price;
        return price != null ? formatCurrency(price) : '\u2014';
      },
    },
    {
      accessorKey: 'sales_rank',
      header: 'Sales Rank',
      cell: ({ row }) => {
        const rank = row.original.sales_rank;
        return rank != null ? rank.toLocaleString() : '\u2014';
      },
    },
    {
      accessorKey: 'offer_count',
      header: 'Offers',
      cell: ({ row }) => {
        const count = row.original.offer_count;
        return count != null ? count.toLocaleString() : '\u2014';
      },
    },
    {
      accessorKey: 'retirement_status',
      header: 'Retirement Status',
      cell: ({ row }) => {
        const status = row.getValue('retirement_status') as string | null;
        if (!status) return <Badge variant="outline">Unknown</Badge>;
        return (
          <Badge variant={RETIREMENT_STATUS_VARIANTS[status] || 'outline'}>
            {RETIREMENT_STATUS_LABELS[status] || status}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'expected_retirement_date',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Expected Retirement
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const date = row.getValue('expected_retirement_date') as string | null;
        return formatDate(date);
      },
    },
    {
      accessorKey: 'retirement_confidence',
      header: 'Confidence',
      cell: ({ row }) => {
        const confidence = row.getValue('retirement_confidence') as string | null;
        if (!confidence) return '-';
        return (
          <Badge variant={CONFIDENCE_VARIANTS[confidence] || 'outline'} className="capitalize">
            {confidence}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'pieces',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="-ml-4"
        >
          Pieces
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const pieces = row.getValue('pieces') as number | null;
        return pieces != null ? pieces.toLocaleString() : '-';
      },
    },
    {
      accessorKey: 'minifigs',
      header: 'Minifigs',
      cell: ({ row }) => row.getValue('minifigs') ?? '-',
    },
    {
      accessorKey: 'exclusivity_tier',
      header: 'Exclusivity',
      cell: ({ row }) => {
        const tier = row.getValue('exclusivity_tier') as string | null;
        if (!tier || tier === 'none') return '-';
        return <Badge variant="secondary" className="capitalize">{tier}</Badge>;
      },
    },
    {
      accessorKey: 'is_licensed',
      header: 'Licensed',
      cell: ({ row }) => {
        const licensed = row.original.is_licensed;
        return licensed ? 'Yes' : licensed === false ? 'No' : '-';
      },
    },
  ];
}
