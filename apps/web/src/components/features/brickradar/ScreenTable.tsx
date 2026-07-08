import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import type { ScreenRow } from './types';

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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows clear the STR/value gate yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Colour</TableHead>
                <TableHead className="text-right">STR N/U</TableHead>
                <TableHead className="text-right">Sold (N)</TableHead>
                <TableHead className="text-right">Sold (U)</TableHead>
                <TableHead className="text-right">Months stock</TableHead>
                {showSpread && <TableHead className="text-right">New/used spread</TableHead>}
                <TableHead className="text-right">Sold value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.item_type}-${r.item_no}-${r.colour_id}`}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {r.item_type} {r.item_no}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{colourCell(r.colour_id)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {str(r.str_new)} / {str(r.str_used)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {soldCell(r.sold6m_new_qty, r.sold6m_new_avg)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {soldCell(r.sold6m_used_qty, r.sold6m_used_avg)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.months_of_stock == null ? '—' : r.months_of_stock.toFixed(1)}
                  </TableCell>
                  {showSpread && (
                    <TableCell className="text-right font-mono">
                      {r.new_used_spread == null ? '—' : `${(r.new_used_spread * 100).toFixed(0)}%`}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono font-medium">
                    {formatCurrency(r.sold_value_gbp)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
