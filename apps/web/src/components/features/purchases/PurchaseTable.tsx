'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/ui/data-table';
import { getPurchaseColumns, COLUMN_DISPLAY_NAMES } from './PurchaseColumns';
import { PurchaseFilters } from './PurchaseFilters';
import { PurchaseBulkEditDialog } from './PurchaseBulkEditDialog';
import {
  usePurchaseList,
  useDeletePurchase,
  useBulkUpdatePurchases,
  useBulkDeletePurchases,
} from '@/hooks';
import type { PurchaseFilters as Filters } from '@/lib/api';
import type { Purchase } from '@hadley-bricks/database';
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
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[]>([]);
  const [bulkEditItems, setBulkEditItems] = useState<Purchase[]>([]);

  const { data, isLoading, error } = usePurchaseList(filters, { page, pageSize });
  const deleteMutation = useDeletePurchase();
  const bulkUpdateMutation = useBulkUpdatePurchases();
  const bulkDeleteMutation = useBulkDeletePurchases();

  const columns = useMemo(
    () => getPurchaseColumns({ onDelete: (id) => setDeleteId(id) }),
    []
  );

  const handleFiltersChange = (newFilters: Filters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  };

  const handleConfirmDelete = async () => {
    if (deleteId) {
      await deleteMutation.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  const handleBulkDelete = useCallback((rows: Purchase[]) => {
    setBulkDeleteIds(rows.map((r) => r.id));
  }, []);

  const handleConfirmBulkDelete = async () => {
    await bulkDeleteMutation.mutateAsync(bulkDeleteIds);
    setBulkDeleteIds([]);
  };

  const handleBulkEdit = useCallback(
    (rows: Purchase[]) => {
      // Navigate to edit page for single item
      if (rows.length === 1) {
        router.push(`/purchases/${rows[0].id}/edit`);
      }
    },
    [router]
  );

  const handleOpenBulkEdit = useCallback((rows: Purchase[]) => {
    setBulkEditItems(rows);
  }, []);

  const handleConfirmBulkEdit = async (updates: Partial<Record<string, string | number | null>>) => {
    const ids = bulkEditItems.map((item) => item.id);
    await bulkUpdateMutation.mutateAsync({ ids, updates });
    setBulkEditItems([]);
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
          getRowId={(row) => row.id}
          enableRowSelection
          enableColumnVisibility
          columnDisplayNames={COLUMN_DISPLAY_NAMES}
          initialColumnVisibility={{
            description: false,
            reference: false,
            created_at: false,
          }}
          bulkActions={{
            onDelete: handleBulkDelete,
            onEdit: handleBulkEdit,
            onBulkEdit: handleOpenBulkEdit,
          }}
          pagination={{
            page: data?.page || 1,
            pageSize: data?.pageSize || pageSize,
            total: data?.total || 0,
            totalPages: data?.totalPages || 1,
            onPageChange: setPage,
            onPageSizeChange: handlePageSizeChange,
          }}
        />
      </div>

      {/* Single item delete dialog */}
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

      {/* Bulk delete dialog */}
      <Dialog open={bulkDeleteIds.length > 0} onOpenChange={() => setBulkDeleteIds([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Bulk Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {bulkDeleteIds.length} purchase(s)? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteIds([])}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBulkDelete}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending
                ? 'Deleting...'
                : `Delete ${bulkDeleteIds.length} purchases`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk edit dialog */}
      <PurchaseBulkEditDialog
        open={bulkEditItems.length > 0}
        onOpenChange={(open) => !open && setBulkEditItems([])}
        selectedCount={bulkEditItems.length}
        onConfirm={handleConfirmBulkEdit}
        isPending={bulkUpdateMutation.isPending}
      />
    </>
  );
}
