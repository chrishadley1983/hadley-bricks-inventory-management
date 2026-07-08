import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/utils';
import { laneLabel, type LaneTelemetryDayRow } from './types';

export function LaneTelemetryTable({ rows }: { rows: LaneTelemetryDayRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lane telemetry — last 14 days (raw detail)</CardTitle>
        <CardDescription>
          Per-lane, per-night acquisition volume behind the block-rate trend chart above. First-block position
          tracks the sessions-to-first-403 trend (spec §4.4) — the tripwire for throttling down before a real ban.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No telemetry rows in the last 7 days — the refresh engine has not run yet, or its scheduled
            task is not wired up.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Lane</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">OK</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">First block at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.lane}-${r.runDate}`}>
                  <TableCell className="whitespace-nowrap">{formatDate(r.runDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">{laneLabel(r.lane)}</TableCell>
                  <TableCell className="text-right font-mono">{r.requests.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-green-600 dark:text-green-400">
                    {r.ok.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${r.failed > 0 ? 'text-red-600 dark:text-red-400' : ''}`}
                  >
                    {r.failed.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.firstBlockAtRequest == null ? '—' : `req #${r.firstBlockAtRequest}`}
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
