'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ORDER_ISSUE_ITEM_TYPES,
  type OrderIssueItemType,
  type OrderIssuePlatform,
} from '@/lib/schemas/order-issue.schema';
import { addOrderIssueItem, lookupOrder } from '@/lib/api/order-issues';

interface PickedItem {
  selected: boolean;
  order_item_id: string;
  item_number: string;
  item_name: string | null;
  item_type: string | null;
  color_id: number | null;
  color_name: string | null;
  condition: 'New' | 'Used' | null;
  qty_ordered: number;
  qty_expected: number;
  qty_received: number;
  issue_type: OrderIssueItemType;
  notes: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueId: string;
  platform: OrderIssuePlatform;
  platformOrderId: string;
  /** order_item_ids already linked to the issue — these get hidden from the picker. */
  existingOrderItemIds: string[];
}

const ISSUE_TYPE_LABELS: Record<OrderIssueItemType, string> = {
  missing_from_inventory: 'Missing from inventory',
  damaged_in_inventory: 'Damaged in inventory',
  missing_from_shipment: 'Missing from shipment',
  damaged_in_transit: 'Damaged in transit',
  wrong_item_sent: 'Wrong item sent',
  wrong_qty_sent: 'Wrong quantity sent',
  shipment_lost: 'Shipment lost',
  other: 'Other',
};

export function AddIssueItemsDialog({
  open,
  onOpenChange,
  issueId,
  platform,
  platformOrderId,
  existingOrderItemIds,
}: Props) {
  const qc = useQueryClient();
  const [items, setItems] = useState<PickedItem[]>([]);

  const lookup = useQuery({
    queryKey: ['order-issue-lookup', platform, platformOrderId],
    queryFn: () => lookupOrder(platform, platformOrderId),
    enabled: open,
    staleTime: 60_000,
  });

  // Hydrate picker rows when lookup data arrives, excluding lots already on the issue
  useEffect(() => {
    if (!lookup.data) return;
    const skip = new Set(existingOrderItemIds);
    setItems(
      lookup.data.items
        .filter((it) => !skip.has(it.order_item_id))
        .map((it) => ({
          selected: false,
          order_item_id: it.order_item_id,
          item_number: it.item_number,
          item_name: it.item_name,
          item_type: it.item_type,
          color_id: it.color_id,
          color_name: it.color_name,
          condition: it.condition,
          qty_ordered: it.quantity,
          qty_expected: it.quantity,
          qty_received: 0,
          issue_type: 'missing_from_inventory',
          notes: '',
        })),
    );
  }, [lookup.data, existingOrderItemIds]);

  const updateItem = (idx: number, patch: Partial<PickedItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const save = useMutation({
    mutationFn: async () => {
      const selected = items.filter((i) => i.selected);
      for (const i of selected) {
        await addOrderIssueItem(issueId, {
          order_item_id: i.order_item_id,
          item_number: i.item_number,
          item_name: i.item_name,
          item_type: i.item_type,
          color_id: i.color_id,
          color_name: i.color_name,
          condition: i.condition,
          qty_expected: i.qty_expected,
          qty_received: i.qty_received,
          issue_type: i.issue_type,
          notes: i.notes || null,
        });
      }
      return selected.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['order-issue', issueId] });
      onOpenChange(false);
      // Brief toast-style log; the panel close + cache invalidation will refresh the list
      console.log(`[order-issues] added ${n} lot(s) to issue ${issueId}`);
    },
  });

  const selectedCount = items.filter((i) => i.selected).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add lots to issue</DialogTitle>
          <DialogDescription>
            Picker lists every lot on this order; lots already on the issue are hidden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {lookup.isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {lookup.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                Failed to load order: {lookup.error?.message}
              </AlertDescription>
            </Alert>
          )}

          {lookup.data && items.length === 0 && (
            <Alert>
              <AlertDescription>
                All lots on this order are already attached to the issue.
              </AlertDescription>
            </Alert>
          )}

          {items.length > 0 && (
            <div className="border rounded max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-8"></th>
                    <th className="px-2 py-1.5">Item</th>
                    <th className="px-2 py-1.5">Colour</th>
                    <th className="px-2 py-1.5 w-16 text-right">Ord</th>
                    <th className="px-2 py-1.5 w-16 text-right">Exp</th>
                    <th className="px-2 py-1.5 w-16 text-right">Rec</th>
                    <th className="px-2 py-1.5">Issue type</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.order_item_id} className="border-t">
                      <td className="px-2 py-1.5">
                        <Checkbox
                          checked={it.selected}
                          onCheckedChange={(c: boolean | 'indeterminate') =>
                            updateItem(idx, { selected: c === true })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-mono text-xs">{it.item_number}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {it.item_name ?? ''}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-xs">{it.color_name ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right">{it.qty_ordered}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          value={it.qty_expected}
                          onChange={(e) =>
                            updateItem(idx, { qty_expected: Number(e.target.value) || 0 })
                          }
                          className="h-7 w-16 text-right"
                          disabled={!it.selected}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          value={it.qty_received}
                          onChange={(e) =>
                            updateItem(idx, { qty_received: Number(e.target.value) || 0 })
                          }
                          className="h-7 w-16 text-right"
                          disabled={!it.selected}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={it.issue_type}
                          onValueChange={(v: string) =>
                            updateItem(idx, { issue_type: v as OrderIssueItemType })
                          }
                          disabled={!it.selected}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ORDER_ISSUE_ITEM_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {ISSUE_TYPE_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {save.error && (
            <Alert variant="destructive">
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={selectedCount === 0 || save.isPending}
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Add {selectedCount > 0 ? `${selectedCount} lot${selectedCount === 1 ? '' : 's'}` : 'lots'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Suppress unused-import warning for Label (kept for future reuse)
void Label;
