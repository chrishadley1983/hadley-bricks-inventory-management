'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { formatCurrency } from '@/lib/utils';
import { STATUS_TEXT } from './chart-colors';
import { ColourSwatch } from './ColourSwatch';
import { InfoTip } from './InfoTip';
import { bricklinkCatalogUrl, type ScreenRow } from './types';

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
      accessorFn: (r) => `${r.item_type} ${r.item_no} ${r.item_name ?? ''}`,
      header: sortHeader('Item'),
      cell: ({ row }) => (
        <div className="flex max-w-[220px] flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {/* Our own drill-down — distinct affordance from the external BrickLink link below. */}
            <Link
              href={`/brickradar/tuple/${row.original.item_type}/${encodeURIComponent(row.original.item_no)}/${row.original.colour_id}`}
              className="font-mono text-xs font-medium hover:underline whitespace-nowrap"
            >
              {row.original.item_type} {row.original.item_no}
            </Link>
            {/* External — BrickLink's own catalogue page for this exact item+colour, new tab. */}
            <a
              href={bricklinkCatalogUrl(row.original.item_type, row.original.item_no, row.original.colour_id)}
              target="_blank"
              rel="noopener noreferrer"
              title="View on BrickLink"
              aria-label="View on BrickLink"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {row.original.item_name && (
            <span className="truncate text-[11px] text-muted-foreground" title={row.original.item_name}>
              {row.original.item_name}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'colour',
      accessorFn: (r) => r.colour_id,
      header: 'Colour',
      cell: ({ row }) => <ColourSwatch colourId={row.original.colour_id} />,
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
  infoTip,
  rows,
  showSpread = false,
}: {
  title: string;
  description: string;
  /** Deeper one-line explanation shown in the header rollover, in addition to `description`. */
  infoTip?: string;
  rows: ScreenRow[];
  showSpread?: boolean;
}) {
  const columns = useMemo(() => buildColumns(showSpread), [showSpread]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            {title}
            {infoTip && <InfoTip text={infoTip} />}
          </span>
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
