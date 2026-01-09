'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/ui/data-table';
import { getInventoryColumns, COLUMN_DISPLAY_NAMES } from './InventoryColumns';
import { InventoryFilters } from './InventoryFilters';
import { BulkEditDialog } from './BulkEditDialog';
import { useInventoryList, useDeleteInventory, useCreateInventory, useBulkUpdateInventory, useBulkDeleteInventory } from '@/hooks';
import type { InventoryFilters as Filters } from '@/lib/api';
import type { InventoryItem } from '@hadley-bricks/database';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function InventoryTable() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[]>([]);
  const [bulkEditItems, setBulkEditItems] = useState<InventoryItem[]>([]);

  const { data, isLoading, error } = useInventoryList(filters, { page, pageSize });
  const deleteMutation = useDeleteInventory();
  const createMutation = useCreateInventory();
  const bulkUpdateMutation = useBulkUpdateInventory();
  const bulkDeleteMutation = useBulkDeleteInventory();

  const columns = useMemo(
    () => getInventoryColumns({ onDelete: (id) => setDeleteId(id) }),
    []
  );

  const handleFiltersChange = (newFilters: Filters) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page on filter change
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1); // Reset to first page when page size changes
  };

  const handleConfirmDelete = async () => {
    if (deleteId) {
      await deleteMutation.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  const handleBulkDelete = useCallback((rows: InventoryItem[]) => {
    setBulkDeleteIds(rows.map((r) => r.id));
  }, []);

  const handleConfirmBulkDelete = async () => {
    await bulkDeleteMutation.mutateAsync(bulkDeleteIds);
    setBulkDeleteIds([]);
  };

  const handleBulkDuplicate = useCallback(async (rows: InventoryItem[]) => {
    for (const row of rows) {
      // Create a copy of the item data for duplication
      await createMutation.mutateAsync({
        set_number: row.set_number,
        item_name: row.item_name ? `${row.item_name} (Copy)` : null,
        condition: row.condition,
        status: row.status,
        source: row.source,
        purchase_date: row.purchase_date,
        cost: row.cost,
        listing_date: row.listing_date,
        listing_value: row.listing_value,
        storage_location: row.storage_location,
        sku: null, // Clear the SKU since it should be unique
        linked_lot: row.linked_lot,
        amazon_asin: row.amazon_asin,
        listing_platform: row.listing_platform,
        notes: row.notes,
      });
    }
  }, [createMutation]);

  const handleBulkEdit = useCallback((rows: InventoryItem[]) => {
    // Navigate to edit page for single item
    if (rows.length === 1) {
      router.push(`/inventory/${rows[0].id}/edit`);
    }
  }, [router]);

  const handleOpenBulkEdit = useCallback((rows: InventoryItem[]) => {
    setBulkEditItems(rows);
  }, []);

  const handleConfirmBulkEdit = async (updates: Partial<Record<string, string | null>>) => {
    const ids = bulkEditItems.map((item) => item.id);
    await bulkUpdateMutation.mutateAsync({ ids, updates });
    setBulkEditItems([]);
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load inventory: {error.message}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <InventoryFilters filters={filters} onFiltersChange={handleFiltersChange} />

        <DataTable
          columns={columns}
          data={data?.data || []}
          isLoading={isLoading}
          getRowId={(row) => row.id}
          enableRowSelection
          enableColumnVisibility
          columnDisplayNames={COLUMN_DISPLAY_NAMES}
          initialColumnVisibility={{
            // Hide these columns by default - users can enable via Columns menu
            sku: false,
            source: false,
            potential_profit: false,
            listing_date: false,
            listing_platform: false,
            amazon_asin: false,
            linked_lot: false,
            notes: false,
            created_at: false,
            updated_at: false,
          }}
          bulkActions={{
            onDelete: handleBulkDelete,
            onDuplicate: handleBulkDuplicate,
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
              Are you sure you want to delete this inventory item? This action cannot be undone.
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
              Are you sure you want to delete {bulkDeleteIds.length} inventory item(s)? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteIds([])}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBulkDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : `Delete ${bulkDeleteIds.length} items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk edit dialog */}
      <BulkEditDialog
        open={bulkEditItems.length > 0}
        onOpenChange={(open) => !open && setBulkEditItems([])}
        selectedCount={bulkEditItems.length}
        onConfirm={handleConfirmBulkEdit}
        isPending={bulkUpdateMutation.isPending}
      />
    </>
  );
}
