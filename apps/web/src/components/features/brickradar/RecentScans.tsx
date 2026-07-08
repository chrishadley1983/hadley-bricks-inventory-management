'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import type { ScanReportRow } from './types';

function verdictVariant(verdict: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (verdict === 'BUY') return 'default';
  if (verdict === 'REVIEW') return 'secondary';
  return 'outline';
}

function verdictClassName(verdict: string | null): string {
  if (verdict === 'BUY') return 'bg-green-100 text-green-800 border-green-200';
  if (verdict === 'REVIEW') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (verdict === 'SKIP') return 'bg-slate-100 text-slate-600 border-slate-200';
  return '';
}

export function RecentScans({ scans }: { scans: ScanReportRow[] }) {
  const [selected, setSelected] = useState<ScanReportRow | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent store scans</CardTitle>
        <CardDescription>Latest 10 bl-pg-store-scan.ts runs. Click a row for the full report.</CardDescription>
      </CardHeader>
      <CardContent>
        {scans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No store scans recorded yet — run{' '}
            <code className="text-xs">npx tsx scripts/bl-pg-store-scan.ts --store-slug=&lt;name&gt;</code>.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead className="text-right">Lots passing</TableHead>
                <TableHead className="text-right">Outlay</TableHead>
                <TableHead className="text-right">Raw net</TableHead>
                <TableHead className="text-right">Realisable net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(s)}
                >
                  <TableCell className="font-medium">{s.store_slug}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(s.scanned_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={verdictVariant(s.verdict)} className={verdictClassName(s.verdict)}>
                      {s.verdict ?? '—'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {s.lots_passing ?? '—'} / {s.lots_total ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(s.outlay_gbp)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(s.raw_net_gbp)}</TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {formatCurrency(s.realisable_net_gbp)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={selected != null} onOpenChange={(open: boolean) => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selected?.store_slug} — {selected ? formatDate(selected.scanned_at) : ''}
            </DialogTitle>
            <DialogDescription>Full markdown report, as written by bl-pg-store-scan.ts.</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 text-xs font-mono">
            {selected?.report_md}
          </pre>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
