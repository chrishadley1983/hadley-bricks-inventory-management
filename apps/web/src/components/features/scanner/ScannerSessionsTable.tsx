'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { format } from 'date-fns';
import { Eye } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScannerStatusBadge } from './ScannerStatusBadge';
import { useScannerSessions } from '@/hooks/use-scanner';
import type { ScannerSession, ScannerSessionSummary } from '@/types/scanner';

function formatDuration(startedAt: string, endedAt: string | null | undefined): string {
  if (!endedAt) return 'In progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

const SCANNER_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'scanning', label: 'Scanning' },
  { value: 'paused', label: 'Paused' },
  { value: 'calibrating', label: 'Calibrating' },
  { value: 'aborted', label: 'Aborted' },
] as const;

const columns: ColumnDef<ScannerSession>[] = [
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <ScannerStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'started_at',
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
      <span className="text-sm">
        {formatDuration(row.original.started_at, row.original.ended_at)}
      </span>
    ),
  },
  {
    id: 'total_pieces',
    header: 'Total Pieces',
    cell: ({ row }) => {
      const summary = row.original.summary_json as ScannerSessionSummary | null | undefined;
      const total = summary?.total_pieces ?? 0;
      return <span className="text-sm">{total.toLocaleString()}</span>;
    },
  },
  {
    id: 'accepted',
    header: 'Accepted',
    cell: ({ row }) => {
      const summary = row.original.summary_json as ScannerSessionSummary | null | undefined;
      const accepted = summary?.accepted_count ?? 0;
      return <span className="text-sm text-green-600">{accepted.toLocaleString()}</span>;
    },
  },
  {
    id: 'flagged',
    header: 'Flagged',
    cell: ({ row }) => {
      const summary = row.original.summary_json as ScannerSessionSummary | null | undefined;
      const flagged = summary?.flagged_count ?? 0;
      return <span className="text-sm text-amber-600">{flagged.toLocaleString()}</span>;
    },
  },
  {
    accessorKey: 'confidence_threshold',
    header: 'Threshold',
    cell: ({ row }) => {
      const val = row.original.confidence_threshold;
      if (val == null) return <span className="text-muted-foreground">—</span>;
      return <span className="text-sm">{(val * 100).toFixed(0)}%</span>;
    },
  },
  {
    id: 'throughput',
    header: 'Throughput',
    cell: ({ row }) => {
      const summary = row.original.summary_json as ScannerSessionSummary | null | undefined;
      const ppm = summary?.pieces_per_minute;
      if (ppm == null) return <span className="text-muted-foreground">—</span>;
      return <span className="text-sm">{ppm.toFixed(1)}/min</span>;
    },
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <a href={`/scanner/${row.original.id}`}>
          <Eye className="h-4 w-4 mr-1" />
          View
        </a>
      </Button>
    ),
  },
];

export function ScannerSessionsTable() {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, isLoading, isError } = useScannerSessions({
    page,
    pageSize,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });

  // data is ScannerSessionsResponse: { sessions, total, page, pageSize, totalPages }
  const sessions = data?.sessions ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? Math.max(1, Math.ceil(total / pageSize));

  if (isError) {
    return (
      <div className="rounded-md border border-destructive p-6 text-center text-sm text-destructive">
        Failed to load scan sessions. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" aria-label="Filter sessions by status">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {SCANNER_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={sessions}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        pagination={{
          page,
          pageSize,
          total,
          totalPages,
          onPageChange: setPage,
        }}
      />

      {!isLoading && sessions.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No scan sessions found
        </div>
      )}
    </div>
  );
}
