import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import type { TrendMoverRow } from './types';

function DeltaTable({ rows }: { rows: TrendMoverRow[] }) {
  return (
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
              {r.item_type} {r.item_no}
            </TableCell>
            <TableCell
              className={`text-right font-mono font-medium ${
                (r.used_qty_delta ?? 0) > 0
                  ? 'text-green-600 dark:text-green-400'
                  : (r.used_qty_delta ?? 0) < 0
                    ? 'text-red-600 dark:text-red-400'
                    : ''
              }`}
            >
              {r.used_qty_delta == null ? '—' : r.used_qty_delta > 0 ? `+${r.used_qty_delta}` : r.used_qty_delta}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {r.latest_used_qty ?? 0} / {r.prior_used_qty ?? 0}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {formatCurrency(r.latest_used_avg)} / {formatCurrency(r.prior_used_avg)}
            </TableCell>
            <TableCell className="text-right font-mono">
              {r.latest_str_used == null ? '—' : r.latest_str_used.toFixed(2)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TrendMovers({ risers, fallers }: { risers: TrendMoverRow[]; fallers: TrendMoverRow[] }) {
  const hasData = risers.length > 0 || fallers.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trend movers</CardTitle>
        <CardDescription>
          Month-over-month used-quantity movers from the latest two snapshot cycles (L2).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <p className="text-sm text-muted-foreground">
            Needs 2+ snapshot cycles — populates after the first month of nightly refreshes.
          </p>
        ) : (
          <>
            <div>
              <h4 className="mb-2 text-sm font-medium text-green-600 dark:text-green-400">Risers</h4>
              {risers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No risers yet.</p>
              ) : (
                <DeltaTable rows={risers} />
              )}
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-red-600 dark:text-red-400">Fallers</h4>
              {fallers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fallers yet.</p>
              ) : (
                <DeltaTable rows={fallers} />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
