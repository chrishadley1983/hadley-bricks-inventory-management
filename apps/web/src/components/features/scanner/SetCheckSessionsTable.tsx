'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { format } from 'date-fns';
import { Eye } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScannerStatusBadge } from './ScannerStatusBadge';
import { useSetCheckSessions } from '@/hooks/use-scanner';
import type { SetCheckSession } from '@/types/scanner';

function formatDuration(startedAt: string | null | undefined, endedAt: string | null | undefined): string {
  if (!startedAt) return '—';
  if (!endedAt) return 'In progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

const columns: ColumnDef<SetCheckSession>[] = [
  {
    accessorKey: 'set_num',
    header: 'Set Number',
    cell: ({ row }) => (
      <span className="font-mono text-sm font-medium">{row.original.set_num}</span>
    ),
  },
  {
    accessorKey: 'set_name',
    header: 'Set Name',
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.set_name}
        {row.original.set_year ? (
          <span className="ml-1 text-muted-foreground">({row.original.set_year})</span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'progress',
    header: 'Progress',
    cell: ({ row }) => {
      const { total_expected } = row.original;
      // We don't have progress rows in the list — show total_expected as reference
      return (
        <div className="flex items-center gap-2 min-w-32">
          <Progress value={0} className="h-2 flex-1" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            0 / {total_expected}
          </span>
        </div>
      );
    },
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.original.status;
      if (!status) return <span className="text-muted-foreground">—</span>;
      return <ScannerStatusBadge status={status} />;
    },
  },
  {
    id: 'started',
    header: 'Started',
    cell: ({ row }) => {
      const val = row.original.started_at;
      if (!val) return <span className="text-muted-foreground">—</span>;
      return <span className="text-sm">{format(new Date(val), 'dd MMM yyyy HH:mm')}</span>;
    },
  },
  {
    id: 'duration',
    header: 'Duration',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatDuration(row.original.started_at, row.original.ended_at)}
      </span>
    ),
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <a href={`/scanner/set-check/${row.original.id}`}>
          <Eye className="h-4 w-4 mr-1" />
          View
        </a>
      </Button>
    ),
  },
];

export function SetCheckSessionsTable() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useSetCheckSessions({ page, pageSize });

  const sessions = data?.sessions ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? Math.max(1, Math.ceil(total / pageSize));

  if (isError) {
    return (
      <div className="rounded-md border border-destructive p-6 text-center text-sm text-destructive">
        Failed to load set-check sessions. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={sessions}
        isLoading={isLoading}
        pagination={{
          page,
          pageSize,
          total,
          totalPages,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
