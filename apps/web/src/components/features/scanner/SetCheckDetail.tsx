'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScannerStatusBadge } from './ScannerStatusBadge';
import { SetCheckProgress } from './SetCheckProgress';
import { SetCheckMissingParts } from './SetCheckMissingParts';
import { SetCheckExportButton } from './SetCheckExportButton';
import { useSetCheckSession } from '@/hooks/use-scanner';
import type { SetCheckProgress as SetCheckProgressType } from '@/types/scanner';

interface SetCheckDetailProps {
  sessionId: string;
}

function PartStatusBadge({ found, expected }: { found: number; expected: number }) {
  if (found >= expected) {
    return (
      <Badge variant="default" className="bg-green-600 text-white text-xs">
        Complete
      </Badge>
    );
  }
  if (found > 0) {
    return (
      <Badge variant="secondary" className="text-xs text-amber-700 bg-amber-100">
        Partial
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-xs">
      Missing
    </Badge>
  );
}

function ColorSwatch({ colorName }: { colorName: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block w-3 h-3 rounded-sm border border-border"
        aria-hidden="true"
      />
      {colorName}
    </span>
  );
}

function AllPartsTable({ progress }: { progress: SetCheckProgressType[] }) {
  const sorted = [...progress].sort((a, b) => {
    // Missing first, then by part_num
    const aMissing = a.found_qty < a.expected_qty ? 0 : 1;
    const bMissing = b.found_qty < b.expected_qty ? 0 : 1;
    if (aMissing !== bMissing) return aMissing - bMissing;
    return a.part_num.localeCompare(b.part_num);
  });

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Part</TableHead>
            <TableHead>Color</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Found</TableHead>
            <TableHead className="text-right">Needed</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => {
            const needed = Math.max(0, p.expected_qty - p.found_qty);
            return (
              <TableRow key={`${p.part_num}-${p.color_id}`}>
                <TableCell className="font-mono text-xs">{p.part_num}</TableCell>
                <TableCell>
                  <ColorSwatch colorName={p.color_name} />
                </TableCell>
                <TableCell className="text-right">{p.expected_qty}</TableCell>
                <TableCell className="text-right">{p.found_qty}</TableCell>
                <TableCell className="text-right">
                  {needed > 0 ? (
                    <span className="text-destructive font-medium">{needed}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <PartStatusBadge found={p.found_qty} expected={p.expected_qty} />
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No parts scanned yet
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function SetCheckDetail({ sessionId }: SetCheckDetailProps) {
  const { data, isLoading, isError } = useSetCheckSession(sessionId);
  const [tab, setTab] = useState<string>('all');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-md border border-destructive p-6 text-center text-sm text-destructive">
        Failed to load set-check session. Please try again.
      </div>
    );
  }

  const { session, progress } = data;
  const missingCount = progress.filter(
    (p) => !p.is_spare && p.found_qty < p.expected_qty
  ).length;

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Button variant="ghost" size="sm" asChild>
        <a href="/scanner/set-check">
          <ArrowLeft className="h-4 w-4 mr-1" />
          All Set Checks
        </a>
      </Button>

      {/* Header card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">
                {session.set_name}
                {session.set_year && (
                  <span className="ml-2 text-muted-foreground font-normal text-base">
                    ({session.set_year})
                  </span>
                )}
              </CardTitle>
              <p className="text-muted-foreground font-mono text-sm mt-1">{session.set_num}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {session.status && <ScannerStatusBadge status={session.status} />}
              <SetCheckExportButton session={session} progress={progress} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <SetCheckProgress session={session} progress={progress} />

          <div className="mt-4 flex gap-6 text-sm text-muted-foreground">
            {session.started_at && (
              <span>
                Started:{' '}
                <span className="text-foreground">
                  {format(new Date(session.started_at), 'dd MMM yyyy HH:mm')}
                </span>
              </span>
            )}
            {session.ended_at && (
              <span>
                Ended:{' '}
                <span className="text-foreground">
                  {format(new Date(session.ended_at), 'dd MMM yyyy HH:mm')}
                </span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Parts tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All Parts ({progress.length})</TabsTrigger>
          <TabsTrigger value="missing">
            Missing
            {missingCount > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs px-1 py-0">
                {missingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <AllPartsTable progress={progress} />
        </TabsContent>

        <TabsContent value="missing" className="mt-4">
          <SetCheckMissingParts progress={progress} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
