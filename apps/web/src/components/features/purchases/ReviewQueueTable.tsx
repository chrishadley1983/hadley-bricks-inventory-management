'use client';

import { useState, useMemo, useCallback } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { getReviewQueueColumns, REVIEW_COLUMN_DISPLAY_NAMES } from './ReviewQueueColumns';
import {
  useReviewQueue,
  useApproveReviewItem,
  useDismissReviewItem,
  useBulkDismissReviewItems,
} from '@/hooks';
import type { ReviewQueueItem } from '@/lib/api/review-queue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, X, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface BundleItem {
  set_number: string;
  condition: 'New' | 'Used';
}

const DEFAULT_BUNDLE_ITEM: BundleItem = { set_number: '', condition: 'Used' };

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`;
}

export function ReviewQueueTable() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [bundleItems, setBundleItems] = useState<Record<string, BundleItem[]>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [bulkDismissIds, setBulkDismissIds] = useState<string[]>([]);

  const { data, isLoading, error } = useReviewQueue(page, pageSize);
  const approveMutation = useApproveReviewItem();
  const dismissMutation = useDismissReviewItem();
  const bulkDismissMutation = useBulkDismissReviewItems();

  const getItemsForRow = useCallback(
    (id: string): BundleItem[] => bundleItems[id] || [{ ...DEFAULT_BUNDLE_ITEM }],
    [bundleItems]
  );

  const updateBundleItem = useCallback(
    (rowId: string, index: number, field: keyof BundleItem, value: string) => {
      setBundleItems((prev) => {
        const current = prev[rowId] || [{ ...DEFAULT_BUNDLE_ITEM }];
        const updated = current.map((item, i) =>
          i === index ? { ...item, [field]: value } : item
        );
        return { ...prev, [rowId]: updated };
      });
    },
    []
  );

  const addBundleItem = useCallback((rowId: string) => {
    setBundleItems((prev) => {
      const current = prev[rowId] || [{ ...DEFAULT_BUNDLE_ITEM }];
      if (current.length >= 10) return prev;
      return { ...prev, [rowId]: [...current, { ...DEFAULT_BUNDLE_ITEM }] };
    });
  }, []);

  const removeBundleItem = useCallback((rowId: string, index: number) => {
    setBundleItems((prev) => {
      const current = prev[rowId] || [{ ...DEFAULT_BUNDLE_ITEM }];
      if (current.length <= 1) return prev;
      return { ...prev, [rowId]: current.filter((_, i) => i !== index) };
    });
  }, []);

  const handleApprove = useCallback(
    async (item: ReviewQueueItem) => {
      const items = getItemsForRow(item.id);
      const validItems = items.filter((i) => i.set_number.trim());

      if (validItems.length === 0) {
        toast.error('Please enter at least one set number');
        return;
      }

      setApprovingId(item.id);
      try {
        const result = await approveMutation.mutateAsync({
          id: item.id,
          data: {
            items: validItems.map((i) => ({
              set_number: i.set_number.trim(),
              condition: i.condition,
            })),
          },
        });

        if (result.items.length === 1) {
          const ri = result.items[0];
          toast.success(
            `Imported ${ri.set_number} ${ri.set_name}` +
              (ri.roi_percent != null ? ` (Est. ROI: ${ri.roi_percent}%)` : '')
          );
        } else {
          const costBreakdown = result.items
            .map((ri) => formatCurrency(ri.allocated_cost))
            .join(' + ');
          const totalCost = result.items.reduce((sum, ri) => sum + ri.allocated_cost, 0);
          toast.success(
            `Imported ${result.items.length} sets (${costBreakdown} allocated from ${formatCurrency(totalCost)})`
          );
        }

        // Clear bundle items for this row
        setBundleItems((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to import');
      } finally {
        setApprovingId(null);
      }
    },
    [getItemsForRow, approveMutation]
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      try {
        await dismissMutation.mutateAsync(id);
        toast.success('Item dismissed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to dismiss');
      }
    },
    [dismissMutation]
  );

  const handleBulkDismiss = useCallback((rows: ReviewQueueItem[]) => {
    setBulkDismissIds(rows.map((r) => r.id));
  }, []);

  const handleConfirmBulkDismiss = async () => {
    try {
      const result = await bulkDismissMutation.mutateAsync(bulkDismissIds);
      toast.success(`Dismissed ${result.dismissed_count} items`);
      setBulkDismissIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to bulk dismiss');
    }
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  };

  // Extend columns with action column
  const columns = useMemo(() => {
    const baseColumns = getReviewQueueColumns();

    return [
      ...baseColumns,
      {
        id: 'set_number_input',
        header: 'Set Number(s)',
        cell: ({ row }: { row: { original: ReviewQueueItem } }) => {
          const item = row.original;
          const isApproving = approvingId === item.id;
          const items = getItemsForRow(item.id);

          return (
            <div className="flex flex-col gap-1">
              {items.map((bundleItem, index) => (
                <div key={index} className="flex items-center gap-1">
                  <Input
                    placeholder="e.g. 75192"
                    value={bundleItem.set_number}
                    onChange={(e) => updateBundleItem(item.id, index, 'set_number', e.target.value)}
                    className="h-8 w-24"
                    disabled={isApproving}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApprove(item);
                      }
                    }}
                  />
                  <Select
                    value={bundleItem.condition}
                    onValueChange={(v: string) =>
                      updateBundleItem(item.id, index, 'condition', v)
                    }
                    disabled={isApproving}
                  >
                    <SelectTrigger className="h-8 w-[70px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New">New</SelectItem>
                      <SelectItem value="Used">Used</SelectItem>
                    </SelectContent>
                  </Select>
                  {items.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeBundleItem(item.id, index)}
                      disabled={isApproving}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
              {items.length < 10 && !isApproving && (
                <button
                  type="button"
                  onClick={() => addBundleItem(item.id)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                  Add set
                </button>
              )}
            </div>
          );
        },
        size: 240,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }: { row: { original: ReviewQueueItem } }) => {
          const item = row.original;
          const isApproving = approvingId === item.id;
          const isDismissing = dismissMutation.isPending;
          const items = getItemsForRow(item.id);
          const validCount = items.filter((i) => i.set_number.trim()).length;

          const importLabel =
            validCount <= 1 ? 'Import' : `Import ${validCount} sets`;

          return (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="default"
                className="h-8 gap-1"
                onClick={() => handleApprove(item)}
                disabled={validCount === 0 || isApproving}
              >
                {isApproving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                {importLabel}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-muted-foreground"
                onClick={() => handleDismiss(item.id)}
                disabled={isDismissing}
              >
                <X className="h-3 w-3" />
                Dismiss
              </Button>
            </div>
          );
        },
        size: 220,
      },
    ];
  }, [
    approvingId,
    dismissMutation.isPending,
    getItemsForRow,
    updateBundleItem,
    addBundleItem,
    removeBundleItem,
    handleApprove,
    handleDismiss,
  ]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load review queue: {error.message}</p>
      </div>
    );
  }

  if (!isLoading && (!data || data.total === 0)) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        <p className="text-lg font-medium">No items to review</p>
        <p className="mt-1 text-sm">
          All email purchases have been processed or dismissed.
        </p>
      </div>
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={data?.items || []}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        enableRowSelection
        enableColumnVisibility
        columnDisplayNames={REVIEW_COLUMN_DISPLAY_NAMES}
        bulkActions={{
          onDelete: handleBulkDismiss,
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

      {/* Bulk dismiss confirmation dialog */}
      <Dialog open={bulkDismissIds.length > 0} onOpenChange={() => setBulkDismissIds([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Items</DialogTitle>
            <DialogDescription>
              Are you sure you want to dismiss {bulkDismissIds.length} item(s)? They will be
              marked as non-LEGO and hidden from the review queue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDismissIds([])}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBulkDismiss}
              disabled={bulkDismissMutation.isPending}
            >
              {bulkDismissMutation.isPending
                ? 'Dismissing...'
                : `Dismiss ${bulkDismissIds.length} items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
