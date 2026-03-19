'use client';

import { useState, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { format } from 'date-fns';
import { Download, Flag, PackagePlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/ui/data-table';
import { ScannerStatusBadge } from './ScannerStatusBadge';
import { PieceCandidatesPopover } from './PieceCandidatesPopover';
import { PieceImageCell } from './PieceImageCell';
import { PieceReviewDialog } from './PieceReviewDialog';
import { PieceReviewQueue } from './PieceReviewQueue';
import { BulkAcceptDialog } from './BulkAcceptDialog';
import { ScanToInventoryWizard } from './ScanToInventoryWizard';
import { useScannerSession, scannerKeys } from '@/hooks/use-scanner';
import { useQueryClient } from '@tanstack/react-query';
import type { ScannerPiece, ScannerSessionSummary } from '@/types/scanner';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string, endedAt: string | null | undefined): string {
  if (!endedAt) return 'In progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatDate(val: string | null | undefined): string {
  if (!val) return '—';
  return format(new Date(val), 'dd MMM yyyy HH:mm:ss');
}

function ConfidenceBar({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground text-sm">—</span>;
  const pct = Math.round(value * 100);
  const colour =
    value >= 0.8 ? 'bg-green-500' : value >= 0.6 ? 'bg-amber-500' : 'bg-destructive';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm tabular-nums">{pct}%</span>
    </div>
  );
}

const pieceStatusConfig: Record<
  string,
  { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }
> = {
  accepted: { variant: 'default', label: 'Accepted' },
  flagged: { variant: 'secondary', label: 'Flagged' },
  rejected: { variant: 'outline', label: 'Rejected' },
  error: { variant: 'destructive', label: 'Error' },
};

function PieceStatusBadge({ status }: { status: string }) {
  const config = pieceStatusConfig[status] ?? { variant: 'outline' as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// ─── Piece table columns ──────────────────────────────────────────────────────

function buildPieceColumns(
  rowOffset: number,
  onReviewPiece: (piece: ScannerPiece) => void
): ColumnDef<ScannerPiece>[] {
  return [
    {
      id: 'index',
      header: '#',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {rowOffset + row.index + 1}
        </span>
      ),
    },
    {
      id: 'image',
      header: 'Image',
      cell: ({ row }) => (
        <PieceImageCell
          imagePath={row.original.image_path}
          altText={row.original.part_id ?? 'Piece'}
        />
      ),
    },
    {
      id: 'part_id',
      header: 'Part ID',
      cell: ({ row }) => (
        <PieceCandidatesPopover
          partId={row.original.part_id}
          candidates={row.original.top_results_json}
        />
      ),
    },
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) =>
        row.original.part_name ? (
          <span className="text-sm">{row.original.part_name}</span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      id: 'category',
      header: 'Category',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.category ?? '—'}</span>
      ),
    },
    {
      id: 'confidence',
      header: 'Confidence',
      cell: ({ row }) => <ConfidenceBar value={row.original.confidence_score} />,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <PieceStatusBadge status={row.original.status} />,
    },
    {
      id: 'sharpness',
      header: 'Sharpness',
      cell: ({ row }) => {
        const val = row.original.sharpness_score;
        if (val == null) return <span className="text-muted-foreground">—</span>;
        return <span className="text-sm tabular-nums">{val.toFixed(1)}</span>;
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) =>
        row.original.status === 'flagged' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReviewPiece(row.original)}
          >
            <Flag className="h-4 w-4 mr-1" />
            Review
          </Button>
        ) : null,
    },
  ];
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ScannerSessionDetailProps {
  sessionId: string;
}

const PAGE_SIZE = 100;

export function ScannerSessionDetail({ sessionId }: ScannerSessionDetailProps) {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [page, setPage] = useState(1);

  // Review dialog state
  const [reviewPiece, setReviewPiece] = useState<ScannerPiece | null>(null);
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
  const [bulkAcceptOpen, setBulkAcceptOpen] = useState(false);
  const [inventoryWizardOpen, setInventoryWizardOpen] = useState(false);

  const queryClient = useQueryClient();

  // useScannerSession handles session metadata, piece filtering, and pagination in one call.
  // When tab or page changes, options change and the query re-fetches with new data.
  const { data, isLoading, isError } = useScannerSession(sessionId, {
    pieceStatus: activeTab !== 'all' ? activeTab : undefined,
    piecePage: page,
    piecePageSize: PAGE_SIZE,
  });

  const session = data?.session;
  const pieces = data?.pieces ?? [];
  const pieceTotal = data?.pieceTotal ?? 0;
  const pieceCounts = data?.pieceCounts ?? { all: 0, accepted: 0, flagged: 0, error: 0 };

  const totalPieces = activeTab === 'all' ? pieceCounts.all : pieceTotal;
  const totalPages = Math.max(1, Math.ceil(totalPieces / PAGE_SIZE));
  const rowOffset = (page - 1) * PAGE_SIZE;

  function invalidateSession() {
    queryClient.invalidateQueries({ queryKey: scannerKeys.session(sessionId) });
  }

  const pieceColumns = useMemo(
    () => buildPieceColumns(rowOffset, (piece) => setReviewPiece(piece)),
    [rowOffset]
  );

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    setPage(1);
  }

  function handleExportJson() {
    if (!session) return;
    const payload = { session, pieces };
    downloadFile(
      `scanner-session-${sessionId.slice(0, 8)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  }

  function handleExportCsv() {
    if (!pieces.length) return;
    const headers = [
      '#',
      'part_id',
      'name',
      'category',
      'confidence',
      'status',
      'sharpness',
    ];
    const rows = pieces.map((p: ScannerPiece, i: number) =>
      [
        rowOffset + i + 1,
        p.part_id ?? '',
        p.part_name ?? '',
        p.category ?? '',
        p.confidence_score != null ? (p.confidence_score * 100).toFixed(1) + '%' : '',
        p.status,
        p.sharpness_score != null ? p.sharpness_score.toFixed(1) : '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    downloadFile(
      `scanner-session-${sessionId.slice(0, 8)}.csv`,
      [headers.join(','), ...rows].join('\n'),
      'text/csv'
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive p-6 text-center text-sm text-destructive">
        Failed to load session. Please try again.
      </div>
    );
  }

  if (isLoading && !session) {
    return <div className="text-sm text-muted-foreground">Loading session…</div>;
  }

  if (!session) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        Session not found.
      </div>
    );
  }

  const summary = session.summary_json as ScannerSessionSummary | null | undefined;
  const cameraConfig = session.camera_config_json as Record<string, unknown> | null | undefined;

  return (
    <div className="space-y-6">
      {/* ── Session summary card ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div>
                <CardTitle className="font-mono text-base">{session.id}</CardTitle>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{formatDate(session.started_at)}</span>
                  {session.ended_at && (
                    <>
                      <span>→</span>
                      <span>{formatDate(session.ended_at)}</span>
                    </>
                  )}
                </div>
              </div>
              <ScannerStatusBadge status={session.status} />
            </div>

            <div className="flex items-center gap-2">
              {session.status === 'completed' && pieceCounts.accepted > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInventoryWizardOpen(true)}
                >
                  <PackagePlus className="h-4 w-4 mr-1" />
                  Add to Inventory
                </Button>
              )}
              {pieceCounts.flagged > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReviewQueueOpen(true)}
                  >
                    <Flag className="h-4 w-4 mr-1" />
                    Review All Flagged
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkAcceptOpen(true)}
                  >
                    Bulk Accept
                  </Button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-1" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportJson}>Export as JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportCsv}>Export as CSV</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Duration" value={formatDuration(session.started_at, session.ended_at)} />
            <Stat
              label="Threshold"
              value={
                session.confidence_threshold != null
                  ? `${(session.confidence_threshold * 100).toFixed(0)}%`
                  : '—'
              }
            />
            <Stat
              label="Camera IP"
              value={String(cameraConfig?.ip ?? cameraConfig?.host ?? '—')}
            />
            <Stat label="FPS" value={String(cameraConfig?.fps ?? '—')} />
            <Stat label="Unique Parts" value={String(summary?.unique_parts ?? '—')} />
            <Stat label="Total" value={String(pieceCounts.all)} />
            <Stat
              label="Accepted"
              value={String(pieceCounts.accepted)}
              valueClassName="text-green-600"
            />
            <Stat
              label="Flagged"
              value={String(pieceCounts.flagged)}
              valueClassName="text-amber-600"
            />
            <Stat
              label="Errors"
              value={String(pieceCounts.error)}
              valueClassName="text-destructive"
            />
            <Stat
              label="Throughput"
              value={
                summary?.pieces_per_minute != null
                  ? `${summary.pieces_per_minute.toFixed(1)}/min`
                  : '—'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Pieces tabs ── */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="all">All ({pieceCounts.all})</TabsTrigger>
          <TabsTrigger value="accepted">Accepted ({pieceCounts.accepted})</TabsTrigger>
          <TabsTrigger value="flagged">Flagged ({pieceCounts.flagged})</TabsTrigger>
          <TabsTrigger value="error">Error ({pieceCounts.error})</TabsTrigger>
        </TabsList>

        {(['all', 'accepted', 'flagged', 'error'] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <DataTable
              columns={pieceColumns}
              data={pieces}
              isLoading={isLoading}
              getRowId={(row) => row.id}
              pagination={{
                page,
                pageSize: PAGE_SIZE,
                total: totalPieces,
                totalPages,
                onPageChange: setPage,
              }}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* ── Review dialogs ── */}
      {reviewPiece && (
        <PieceReviewDialog
          piece={reviewPiece}
          open={!!reviewPiece}
          onOpenChange={(open) => {
            if (!open) setReviewPiece(null);
          }}
          onReviewed={() => {
            setReviewPiece(null);
            invalidateSession();
          }}
        />
      )}

      <PieceReviewQueue
        pieces={pieces}
        open={reviewQueueOpen}
        onOpenChange={setReviewQueueOpen}
        onComplete={() => {
          setReviewQueueOpen(false);
          invalidateSession();
        }}
      />

      <BulkAcceptDialog
        pieces={pieces}
        open={bulkAcceptOpen}
        onOpenChange={setBulkAcceptOpen}
        onComplete={() => {
          setBulkAcceptOpen(false);
          invalidateSession();
        }}
      />

      <ScanToInventoryWizard
        sessionId={sessionId}
        pieces={pieces}
        open={inventoryWizardOpen}
        onOpenChange={setInventoryWizardOpen}
        onComplete={invalidateSession}
      />
    </div>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${valueClassName ?? ''}`}>{value}</p>
    </div>
  );
}
