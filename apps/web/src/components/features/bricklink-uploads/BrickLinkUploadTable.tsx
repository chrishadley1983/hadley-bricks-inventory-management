'use client';

import { useState, useMemo } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { getBrickLinkUploadColumns } from './BrickLinkUploadColumns';
import { BrickLinkUploadFilters } from './BrickLinkUploadFilters';
import { BrickLinkUploadSummary } from './BrickLinkUploadSummary';
import { useBrickLinkUploadList, useDeleteBrickLinkUpload } from '@/hooks/use-bricklink-uploads';
import type { BrickLinkUploadFilters as Filters } from '@/lib/api/bricklink-uploads';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function BrickLinkUploadTable() {
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const pageSize = 25;

  const { data, isLoading, error } = useBrickLinkUploadList(filters, { page, pageSize });
  const deleteMutation = useDeleteBrickLinkUpload();

  const columns = useMemo(
    () => getBrickLinkUploadColumns({ onDelete: (id) => setDeleteId(id) }),
    []
  );

  const handleFiltersChange = (newFilters: Filters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handleConfirmDelete = async () => {
    if (deleteId) {
      await deleteMutation.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load uploads: {error.message}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <BrickLinkUploadFilters filters={filters} onFiltersChange={handleFiltersChange} />

        {data?.data && data.data.length > 0 && <BrickLinkUploadSummary uploads={data.data} />}

        <DataTable
          columns={columns}
          data={data?.data || []}
          isLoading={isLoading}
          pagination={{
            page: data?.page || 1,
            pageSize: data?.pageSize || pageSize,
            total: data?.total || 0,
            totalPages: data?.totalPages || 1,
            onPageChange: setPage,
          }}
        />
      </div>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this upload? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
