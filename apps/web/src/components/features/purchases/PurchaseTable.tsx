'use client';

import { useState, useMemo } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { getPurchaseColumns } from './PurchaseColumns';
import { PurchaseFilters } from './PurchaseFilters';
import { usePurchaseList, useDeletePurchase } from '@/hooks';
import type { PurchaseFilters as Filters } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function PurchaseTable() {
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const pageSize = 25;

  const { data, isLoading, error } = usePurchaseList(filters, { page, pageSize });
  const deleteMutation = useDeletePurchase();

  const columns = useMemo(
    () => getPurchaseColumns({ onDelete: (id) => setDeleteId(id) }),
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
        <p>Failed to load purchases: {error.message}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <PurchaseFilters filters={filters} onFiltersChange={handleFiltersChange} />

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
              Are you sure you want to delete this purchase? This action cannot be undone.
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
