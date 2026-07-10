'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { CHART_TOOLTIP_STYLE, TREND_POS_VAR, TREND_NEG_VAR } from './chart-colors';
import { InfoTip } from './InfoTip';
import type { TrendMoverRow } from './types';

function tupleLabel(r: TrendMoverRow): string {
  return `${r.item_type} ${r.item_no}${r.colour_id > 0 ? ` #${r.colour_id}` : ''}`;
}

interface DivergingPoint {
  label: string;
  delta: number;
  positive: boolean;
}

function buildDivergingData(risers: TrendMoverRow[], fallers: TrendMoverRow[], capEach: number): DivergingPoint[] {
  const top = [...risers]
    .sort((a, b) => (b.used_qty_delta ?? 0) - (a.used_qty_delta ?? 0))
    .slice(0, capEach)
    .map((r) => ({ label: tupleLabel(r), delta: r.used_qty_delta ?? 0, positive: true }));
  const bottom = [...fallers]
    .sort((a, b) => (a.used_qty_delta ?? 0) - (b.used_qty_delta ?? 0))
    .slice(0, capEach)
    .map((r) => ({ label: tupleLabel(r), delta: r.used_qty_delta ?? 0, positive: false }));
  // Risers descending at top, fallers ascending (most negative last) at bottom — a classic
  // diverging tornado order read top-to-bottom as "best mover" to "worst mover".
  return [...top, ...bottom.slice().reverse()];
}

function DivergingChart({ risers, fallers }: { risers: TrendMoverRow[]; fallers: TrendMoverRow[] }) {
  const data = buildDivergingData(risers, fallers, 12);
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.delta)));

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
        <XAxis
          type="number"
          domain={[-maxAbs, maxAbs]}
          className="text-xs fill-muted-foreground"
          tickLine={false}
          label={{ value: 'used-qty Δ (month over month)', position: 'insideBottom', offset: -5, className: 'fill-muted-foreground text-[10px]' }}
        />
        <YAxis type="category" dataKey="label" width={130} className="text-xs fill-muted-foreground" tickLine={false} />
        <ReferenceLine x={0} stroke="hsl(var(--border))" strokeWidth={1.5} />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(v: number | undefined) => [`${(v ?? 0) > 0 ? '+' : ''}${v ?? 0}`, 'Used-qty Δ']}
        />
        <Bar dataKey="delta" radius={[2, 2, 2, 2]} maxBarSize={16}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.positive ? TREND_POS_VAR : TREND_NEG_VAR} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DeltaTable({ rows, title, icon: Icon, tone }: { rows: TrendMoverRow[]; title: string; icon: React.ElementType; tone: string }) {
  return (
    <div>
      <h4 className={`mb-2 flex items-center gap-1.5 text-sm font-medium ${tone}`}>
        <Icon className="h-4 w-4" />
        {title}
      </h4>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Used qty Δ</TableHead>
              <TableHead className="text-right">Used qty (latest / prior)</TableHead>
              <TableHead className="text-right">Used avg (latest / prior)</TableHead>
              <TableHead className="text-right">STR U</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.item_type}-${r.item_no}-${r.colour_id}`}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  <Link
                    href={`/brickradar/tuple/${r.item_type}/${encodeURIComponent(r.item_no)}/${r.colour_id}`}
                    className="hover:underline"
                  >
                    {tupleLabel(r)}
                  </Link>
                </TableCell>
                <TableCell className={`text-right font-mono font-medium tabular-nums ${tone}`}>
                  {r.used_qty_delta == null ? '—' : r.used_qty_delta > 0 ? `+${r.used_qty_delta}` : r.used_qty_delta}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {r.latest_used_qty ?? 0} / {r.prior_used_qty ?? 0}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(r.latest_used_avg)} / {formatCurrency(r.prior_used_avg)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.latest_str_used == null ? '—' : r.latest_str_used.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function TrendMovers({ risers, fallers }: { risers: TrendMoverRow[]; fallers: TrendMoverRow[] }) {
  const hasData = risers.length > 0 || fallers.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Trend movers
          <InfoTip text="Which tuples moved most in stocked used-quantity between the two most recent monthly L2 snapshots — a signal for restocks and sales-pace shifts." />
        </CardTitle>
        <CardDescription>
          Month-over-month used-quantity movers between each tuple&apos;s two most recent L2 snapshots.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <p className="text-sm text-muted-foreground">
            Populates after 2+ nightly snapshot cycles (~a month).
          </p>
        ) : (
          <>
            <DivergingChart risers={risers} fallers={fallers} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <DeltaTable rows={risers.slice(0, 10)} title="Risers" icon={TrendingUp} tone="text-green-600 dark:text-green-400" />
              <DeltaTable rows={fallers.slice(0, 10)} title="Fallers" icon={TrendingDown} tone="text-red-600 dark:text-red-400" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
