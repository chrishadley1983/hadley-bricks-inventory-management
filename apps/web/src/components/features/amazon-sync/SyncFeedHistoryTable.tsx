'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Eye, CheckCircle2, XCircle, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SyncFeedDetailDialog } from './SyncFeedDetailDialog';
import type { SyncFeed } from '@/lib/amazon/amazon-sync.types';

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusIcon(status: string): React.ElementType {
  switch (status) {
    case 'done':
    case 'verified':
    case 'completed':
    case 'price_verified':
      return CheckCircle2;
    case 'cancelled':
    case 'fatal':
    case 'error':
    case 'failed':
    case 'verification_failed':
      return XCircle;
    case 'submitted':
    case 'processing':
    case 'done_verifying':
    case 'price_verifying':
    case 'price_submitted':
    case 'price_processing':
    case 'quantity_submitted':
    case 'quantity_processing':
      return Loader2;
    case 'processing_timeout':
      return AlertTriangle;
    default:
      return Clock;
  }
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'done':
    case 'verified':
    case 'completed':
    case 'price_verified':
      return 'default';
    case 'cancelled':
    case 'fatal':
    case 'error':
    case 'failed':
    case 'verification_failed':
    case 'processing_timeout':
      return 'destructive';
    case 'submitted':
    case 'processing':
    case 'done_verifying':
    case 'price_verifying':
    case 'price_submitted':
    case 'price_processing':
    case 'quantity_submitted':
    case 'quantity_processing':
      return 'secondary';
    default:
      return 'outline';
  }
}

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

function getColumns(onViewDetails: (feed: SyncFeed) => void): ColumnDef<SyncFeed>[] {
  return [
    {
      accessorKey: 'created_at',
      header: 'Date',
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status;
        const Icon = getStatusIcon(status);
        const isProcessing = status === 'submitted' || status === 'processing';

        return (
          <Badge variant={getStatusVariant(status)} className="flex items-center gap-1 w-fit">
            <Icon className={`h-3 w-3 ${isProcessing ? 'animate-spin' : ''}`} />
            <span className="capitalize">{status.replace('_', ' ')}</span>
          </Badge>
        );
      },
    },
    {
      accessorKey: 'is_dry_run',
      header: 'Type',
      cell: ({ row }) => {
        const feed = row.original as SyncFeed & { sync_mode?: string; phase?: string };
        const isTwoPhase = feed.sync_mode === 'two_phase';
        const phase = feed.phase;

        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline">{row.original.is_dry_run ? 'Dry Run' : 'Live'}</Badge>
            {isTwoPhase && (
              <Badge variant="secondary" className="text-xs">
                {phase === 'price' ? 'Price' : phase === 'quantity' ? 'Qty' : '2-Phase'}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'total_items',
      header: 'Items',
      cell: ({ row }) => row.original.total_items,
    },
    {
      id: 'results',
      header: 'Results',
      cell: ({ row }) => {
        const { success_count, warning_count, error_count, status } = row.original;
        const isComplete = !['pending', 'submitted', 'processing'].includes(status);

        if (!isComplete) {
          return <span className="text-muted-foreground">-</span>;
        }

        return (
          <div className="flex items-center gap-2 text-sm">
            {(success_count ?? 0) > 0 && <span className="text-green-600">{success_count} ok</span>}
            {(warning_count ?? 0) > 0 && (
              <span className="text-yellow-600">{warning_count} warn</span>
            )}
            {(error_count ?? 0) > 0 && <span className="text-red-600">{error_count} err</span>}
          </div>
        );
      },
    },
    {
      accessorKey: 'completed_at',
      header: 'Completed',
      cell: ({ row }) => formatDate(row.original.completed_at),
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onViewDetails(row.original)}
          className="h-8 w-8"
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];
}

// ============================================================================
// COMPONENT
// ============================================================================

interface SyncFeedHistoryTableProps {
  feeds: SyncFeed[];
  isLoading?: boolean;
}

export function SyncFeedHistoryTable({ feeds, isLoading }: SyncFeedHistoryTableProps) {
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);

  const handleViewDetails = (feed: SyncFeed) => {
    setSelectedFeedId(feed.id);
  };

  const columns = getColumns(handleViewDetails);

  return (
    <>
      <DataTable
        columns={columns}
        data={feeds}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        enableRowSelection={false}
        enableColumnVisibility={false}
      />

      <SyncFeedDetailDialog
        feedId={selectedFeedId}
        open={!!selectedFeedId}
        onOpenChange={(open) => !open && setSelectedFeedId(null)}
      />
    </>
  );
}
