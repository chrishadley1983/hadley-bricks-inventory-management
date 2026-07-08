'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { formatCurrency } from '@/lib/utils';
import { STATUS_TEXT } from './chart-colors';
import type { ScreenRow } from './types';

function sortHeader(label: string) {
  return function Header({ column }: { column: { toggleSorting: (asc: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' } }) {
    return (
      <Button variant="ghost" size="sm" className="-ml-3 h-7" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
        {label}
        <ArrowUpDown className="ml-1.5 h-3 w-3" />
      </Button>
    );
  };
}

function str(n: number | null): string {
  return n == null ? '—' : n.toFixed(2);
}

function soldCell(qty: number | null, avg: number | null): string {
  if (!qty) return '—';
  return `${qty} @ ${formatCurrency(avg)}`;
}

function colourCell(colourId: number): string {
  return colourId > 0 ? `#${colourId}` : '—';
}

function maxStr(r: ScreenRow): number {
  return Math.max(r.str_new ?? 0, r.str_used ?? 0);
}

function StrBadge({ value }: { value: number }) {
  if (value >= 1.5) {
    return (
      <Badge variant="outline" className={`gap-1 border-green-200 dark:border-green-900 ${STATUS_TEXT.good}`}>
        <TrendingUp className="h-3 w-3" />
        High
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">OK</span>;
}

function StockPaceBadge({ months }: { months: number | null }) {
  if (months == null) return <span className="text-muted-foreground">—</span>;
  if (months > 6) {
    return (
      <span className={`inline-flex items-center gap-1 ${STATUS_TEXT.warn}`} title="Slow — more than 6 months of stock at current velocity">
        <TrendingDown className="h-3 w-3" />
        {months.toFixed(1)}
      </span>
    );
  }
  return <span>{months.toFixed(1)}</span>;
}

function buildColumns(showSpread: boolean): ColumnDef<ScreenRow>[] {
  const cols: ColumnDef<ScreenRow>[] = [
    {
      id: 'item',
      accessorFn: (r) => `${r.item_type} ${r.item_no}`,
      header: sortHeader('Item'),
      cell: ({ row }) => (
        <Link
          href={`/brickradar/tuple/${row.original.item_type}/${encodeURIComponent(row.original.item_no)}/${row.original.colour_id}`}
          className="font-mono text-xs font-medium hover:underline whitespace-nowrap"
        >
          {row.original.item_type} {row.original.item_no}
        </Link>
      ),
    },
    {
      id: 'colour',
      accessorFn: (r) => r.colour_id,
      header: 'Colour',
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{colourCell(row.original.colour_id)}</span>,
    },
    {
      id: 'str',
      accessorFn: maxStr,
      header: sortHeader('STR N/U'),
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2 tabular-nums">
          <span className="font-mono text-xs">
            {str(row.original.str_new)} / {str(row.original.str_used)}
          </span>
          <StrBadge value={maxStr(row.original)} />
        </div>
      ),
    },
    {
      id: 'soldNew',
      accessorFn: (r) => r.sold6m_new_qty ?? 0,
      header: sortHeader('Sold (N)'),
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">{soldCell(row.original.sold6m_new_qty, row.original.sold6m_new_avg)}</span>
      ),
    },
    {
      id: 'soldUsed',
      accessorFn: (r) => r.sold6m_used_qty ?? 0,
      header: sortHeader('Sold (U)'),
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">{soldCell(row.original.sold6m_used_qty, row.original.sold6m_used_avg)}</span>
      ),
    },
    {
      id: 'months',
      accessorFn: (r) => r.months_of_stock ?? -1,
      header: sortHeader('Months stock'),
      cell: ({ row }) => (
        <div className="text-right font-mono text-xs tabular-nums">
          <StockPaceBadge months={row.original.months_of_stock} />
        </div>
      ),
    },
  ];

  if (showSpread) {
    cols.push({
      id: 'spread',
      accessorFn: (r) => r.new_used_spread ?? 0,
      header: sortHeader('New/used spread'),
      cell: ({ row }) => (
        <span className="text-right font-mono text-xs tabular-nums block">
          {row.original.new_used_spread == null ? '—' : `${(row.original.new_used_spread * 100).toFixed(0)}%`}
        </span>
      ),
    });
  }

  cols.push({
    id: 'soldValue',
    accessorFn: (r) => r.sold_value_gbp ?? 0,
    header: sortHeader('Sold value'),
    cell: ({ row }) => (
      <span className="text-right font-mono text-xs font-medium tabular-nums block">{formatCurrency(row.original.sold_value_gbp)}</span>
    ),
  });

  return cols;
}

export function ScreenTable({
  title,
  description,
  rows,
  showSpread = false,
}: {
  title: string;
  description: string;
  rows: ScreenRow[];
  showSpread?: boolean;
}) {
  const columns = useMemo(() => buildColumns(showSpread), [showSpread]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{title}</span>
          <span className="text-xs font-normal text-muted-foreground">{rows.length.toLocaleString()} rows</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows clear the STR/value gate yet.</p>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            searchKey="item"
            searchPlaceholder="Search item no..."
            getRowId={(r) => `${r.item_type}-${r.item_no}-${r.colour_id}`}
          />
        )}
      </CardContent>
    </Card>
  );
}
