'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/ui/data-table';
import { getInventoryColumns, COLUMN_DISPLAY_NAMES } from './InventoryColumns';
import { InventoryFilters } from './InventoryFilters';
import { BulkEditDialog } from './BulkEditDialog';
import { PriceConflictDialog } from '../amazon-sync/PriceConflictDialog';
import { useInventoryList, useDeleteInventory, useCreateInventory, useUpdateInventory, useBulkUpdateInventory, useBulkDeleteInventory } from '@/hooks';
import { useAddToSyncQueue, type PriceConflict } from '@/hooks/use-amazon-sync';
import { useToast } from '@/hooks/use-toast';
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
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[]>([]);
  const [bulkEditItems, setBulkEditItems] = useState<InventoryItem[]>([]);
  // Queue of pending price conflicts to resolve one by one
  const [pendingConflicts, setPendingConflicts] = useState<PriceConflict[]>([]);
  const currentConflict = pendingConflicts[0] ?? null;

  const { data, isLoading, error } = useInventoryList(filters, { page, pageSize });
  const deleteMutation = useDeleteInventory();
  const createMutation = useCreateInventory();
  const updateMutation = useUpdateInventory();
  const bulkUpdateMutation = useBulkUpdateInventory();
  const bulkDeleteMutation = useBulkDeleteInventory();
  const addToSyncQueueMutation = useAddToSyncQueue();

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

  const handleInlineUpdate = useCallback(async (id: string, data: Partial<InventoryItem>) => {
    await updateMutation.mutateAsync({ id, data });
  }, [updateMutation]);

  const handleOpenBulkEdit = useCallback((rows: InventoryItem[]) => {
    setBulkEditItems(rows);
  }, []);

  const handleAddToAmazonSync = useCallback(async (item: InventoryItem) => {
    if (!item.amazon_asin) {
      toast({
        title: 'Cannot add to sync',
        description: 'This item does not have an Amazon ASIN.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const result = await addToSyncQueueMutation.mutateAsync({ inventoryItemId: item.id });

      // Check for price conflict
      if (result.priceConflict) {
        setPendingConflicts([result.priceConflict]);
        return;
      }

      toast({
        title: 'Added to sync queue',
        description: `${item.set_number} has been added to the Amazon sync queue.`,
      });
    } catch (error) {
      toast({
        title: 'Failed to add to queue',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [addToSyncQueueMutation, toast]);

  const handleBulkAddToAmazonSync = useCallback(async (rows: InventoryItem[]) => {
    const itemsWithAsin = rows.filter(row => row.amazon_asin);
    if (itemsWithAsin.length === 0) {
      toast({
        title: 'No eligible items',
        description: 'None of the selected items have an Amazon ASIN.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const result = await addToSyncQueueMutation.mutateAsync({
        inventoryItemIds: itemsWithAsin.map(item => item.id),
      });
      const skippedCount = rows.length - itemsWithAsin.length;

      // Check for price conflicts - queue all of them to resolve one by one
      if (result.priceConflicts && result.priceConflicts.length > 0) {
        const conflictCount = result.priceConflicts.length;
        // Queue all conflicts to resolve sequentially
        setPendingConflicts(result.priceConflicts);

        // Show a toast about what's happening
        if (result.added && result.added > 0) {
          toast({
            title: 'Partial success',
            description: `${result.added} item(s) added. Resolving ${conflictCount} price conflict(s)...`,
          });
        } else {
          toast({
            title: 'Price conflicts detected',
            description: `Resolving ${conflictCount} price conflict(s)...`,
          });
        }
        return;
      }

      // Check if all items failed with other errors
      if (result.added === 0 && result.errors && result.errors.length > 0) {
        toast({
          title: 'Failed to add to queue',
          description: result.errors[0].split(': ')[1] || result.errors[0],
          variant: 'destructive',
        });
        return;
      }

      let description = `${result.added} item(s) added to Amazon sync queue.`;
      if (skippedCount > 0) {
        description += ` ${skippedCount} item(s) skipped (no ASIN).`;
      }
      if (result.skipped) {
        description += ` ${result.skipped} already in queue.`;
      }
      if (result.errors && result.errors.length > 0) {
        description += ` ${result.errors.length} failed.`;
      }
      const addedCount = result.added ?? 0;
      toast({
        title: addedCount > 0 ? 'Added to sync queue' : 'No items added',
        description,
        variant: addedCount > 0 ? 'default' : 'destructive',
      });
    } catch (error) {
      toast({
        title: 'Failed to add to queue',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [addToSyncQueueMutation, toast]);

  const columns = useMemo(
    () => getInventoryColumns({
      onDelete: (id) => setDeleteId(id),
      onAddToAmazonSync: handleAddToAmazonSync,
      onUpdate: handleInlineUpdate,
    }),
    [handleAddToAmazonSync, handleInlineUpdate]
  );

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
          columnVisibilityStorageKey="inventory-table-columns"
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
            onAddToAmazonSync: handleBulkAddToAmazonSync,
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

      {/* Price conflict dialog */}
      <PriceConflictDialog
        open={!!currentConflict}
        onOpenChange={(open) => {
          if (!open) {
            // User cancelled - remove current conflict and move to next
            setPendingConflicts((prev) => prev.slice(1));
          }
        }}
        conflict={currentConflict}
        remainingCount={pendingConflicts.length - 1}
        onResolved={(message) => {
          toast({
            title: 'Added to sync queue',
            description: message,
          });
          // Move to next conflict
          setPendingConflicts((prev) => prev.slice(1));
        }}
      />
    </>
  );
}
