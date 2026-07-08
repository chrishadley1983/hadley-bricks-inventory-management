'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpDown, HelpCircle, ShieldAlert, Repeat } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/utils';
import { MiniMarkdown } from './markdown';
import type { ScanReportRow } from './types';

function verdictClassName(verdict: string | null): string {
  if (verdict === 'BUY') return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900';
  if (verdict === 'REVIEW') return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900';
  if (verdict === 'SKIP') return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800';
  return '';
}

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

function FlagCount({ icon: Icon, value, title }: { icon: React.ElementType; value: number | null; title: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title={title}>
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}

function buildColumns(onSelect: (row: ScanReportRow) => void): ColumnDef<ScanReportRow>[] {
  return [
    {
      accessorKey: 'store_slug',
      header: sortHeader('Store'),
      cell: ({ row }) => (
        <button className="font-medium hover:underline" onClick={() => onSelect(row.original)}>
          {row.original.store_slug}
        </button>
      ),
    },
    {
      accessorKey: 'scanned_at',
      header: sortHeader('Date'),
      cell: ({ row }) => <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.original.scanned_at)}</span>,
    },
    {
      accessorKey: 'verdict',
      header: 'Verdict',
      cell: ({ row }) => <Badge variant="outline" className={verdictClassName(row.original.verdict)}>{row.original.verdict ?? '—'}</Badge>,
    },
    {
      id: 'lotsPassing',
      accessorFn: (r) => r.lots_passing ?? 0,
      header: sortHeader('Lots passing'),
      cell: ({ row }) => (
        <span className="block text-right font-mono tabular-nums">
          {row.original.lots_passing ?? '—'} / {row.original.lots_total ?? '—'}
        </span>
      ),
    },
    {
      id: 'outlay',
      accessorFn: (r) => r.outlay_gbp ?? 0,
      header: sortHeader('Outlay'),
      cell: ({ row }) => <span className="block text-right font-mono tabular-nums">{formatCurrency(row.original.outlay_gbp)}</span>,
    },
    {
      id: 'rawNet',
      accessorFn: (r) => r.raw_net_gbp ?? 0,
      header: sortHeader('Raw net'),
      cell: ({ row }) => <span className="block text-right font-mono tabular-nums">{formatCurrency(row.original.raw_net_gbp)}</span>,
    },
    {
      id: 'realisableNet',
      accessorFn: (r) => r.realisable_net_gbp ?? 0,
      header: sortHeader('Realisable net'),
      cell: ({ row }) => (
        <span className="block text-right font-mono font-medium tabular-nums">{formatCurrency(row.original.realisable_net_gbp)}</span>
      ),
    },
    {
      id: 'flags',
      header: 'Flags',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-3">
          <FlagCount icon={HelpCircle} value={row.original.identity_ambiguous} title="Identity ambiguous" />
          <FlagCount icon={ShieldAlert} value={row.original.floor_unviable} title="Floor-unviable (below the 7p Bricqer floor)" />
          <FlagCount icon={Repeat} value={row.original.variant_recovered} title="Variant recovered" />
        </div>
      ),
      enableSorting: false,
    },
  ];
}

export function RecentScans({ scans }: { scans: ScanReportRow[] }) {
  const [selected, setSelected] = useState<ScanReportRow | null>(null);
  const columns = useMemo(() => buildColumns(setSelected), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Recent store scans</span>
          <span className="text-xs font-normal text-muted-foreground">{scans.length.toLocaleString()} of latest 15</span>
        </CardTitle>
        <CardDescription>Latest bl-pg-store-scan.ts runs. Click a store to open the full report.</CardDescription>
      </CardHeader>
      <CardContent>
        {scans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No store scans recorded yet — run{' '}
            <code className="text-xs">npx tsx scripts/pg/bl-pg-store-scan.ts --store-slug=&lt;name&gt;</code>.
          </p>
        ) : (
          <DataTable columns={columns} data={scans} getRowId={(s) => String(s.id)} />
        )}
      </CardContent>

      <Dialog open={selected != null} onOpenChange={(open: boolean) => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selected?.store_slug} — {selected ? formatDate(selected.scanned_at) : ''}
            </DialogTitle>
            <DialogDescription>
              {selected?.verdict} · {selected?.lots_passing ?? 0}/{selected?.lots_total ?? 0} lots passing · realisable net{' '}
              {formatCurrency(selected?.realisable_net_gbp)}
            </DialogDescription>
          </DialogHeader>
          {selected && <MiniMarkdown markdown={selected.report_md} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
