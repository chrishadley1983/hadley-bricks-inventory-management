'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ORDER_ISSUE_PLATFORMS,
  ORDER_ISSUE_DISCOVERED_BY,
  ORDER_ISSUE_ITEM_TYPES,
  type OrderIssuePlatform,
  type OrderIssueDiscoveredBy,
  type OrderIssueItemType,
} from '@/lib/schemas/order-issue.schema';
import { lookupOrder, createOrderIssue } from '@/lib/api/order-issues';
import type { OrderLookupResult } from '@/lib/services';

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

export function NewOrderIssueDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState<OrderIssuePlatform>('bricklink');
  const [orderId, setOrderId] = useState('');
  const [discoveredBy, setDiscoveredBy] = useState<OrderIssueDiscoveredBy>('us');
  const [plannedResolution, setPlannedResolution] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderLookupResult | null>(null);
  const [items, setItems] = useState<PickedItem[]>([]);

  const lookupMutation = useMutation({
    mutationFn: () => lookupOrder(platform, orderId.trim()),
    onSuccess: (data) => {
      setOrder(data);
      setLookupError(null);
      setItems(
        data.items.map((it) => ({
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
    },
    onError: (e: Error) => {
      setOrder(null);
      setItems([]);
      setLookupError(e.message);
    },
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const selected = items.filter((i) => i.selected);
      return createOrderIssue({
        platform,
        platform_order_id: orderId.trim(),
        discovered_by: discoveredBy,
        planned_resolution: plannedResolution.trim() || undefined,
        items: selected.map((i) => ({
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
        })),
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['order-issues'] });
      router.push(`/order-issues/${created.issue.id}`);
      // Close after navigation has been queued so the router push isn't lost when
      // the dialog unmounts.
      setTimeout(() => {
        onOpenChange(false);
        reset();
      }, 0);
    },
  });

  const reset = () => {
    setPlatform('bricklink');
    setOrderId('');
    setDiscoveredBy('us');
    setPlannedResolution('');
    setLookupError(null);
    setOrder(null);
    setItems([]);
  };

  const updateItem = (idx: number, patch: Partial<PickedItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const canSave = order && (items.some((i) => i.selected) || items.length === 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(o: boolean) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New order issue</DialogTitle>
          <DialogDescription>
            Anchor the issue to a BrickLink or BrickOwl sales order, then pick the affected lots.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[150px_1fr_auto] gap-2 items-end">
            <div>
              <Label htmlFor="platform">Platform</Label>
              <Select
                value={platform}
                onValueChange={(v: string) => setPlatform(v as OrderIssuePlatform)}
              >
                <SelectTrigger id="platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_ISSUE_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="order-id">Order #</Label>
              <Input
                id="order-id"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="31411686"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!orderId.trim() || lookupMutation.isPending}
              onClick={() => lookupMutation.mutate()}
            >
              {lookupMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="ml-1">Lookup</span>
            </Button>
          </div>

          {lookupError && (
            <Alert variant="destructive">
              <AlertDescription>{lookupError}</AlertDescription>
            </Alert>
          )}

          {order && (
            <>
              <div className="rounded border bg-muted/40 p-3 text-sm grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Buyer:</span>{' '}
                  {order.buyer_name ?? '—'}
                </div>
                <div>
                  <span className="text-muted-foreground">Order date:</span>{' '}
                  {order.order_date
                    ? new Date(order.order_date).toLocaleDateString('en-GB')
                    : '—'}
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{' '}
                  {order.order_status ?? '—'}
                </div>
                <div>
                  <span className="text-muted-foreground">Lots:</span> {order.items.length}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Discovered by</Label>
                  <Select
                    value={discoveredBy}
                    onValueChange={(v: string) => setDiscoveredBy(v as OrderIssueDiscoveredBy)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORDER_ISSUE_DISCOVERED_BY.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d === 'us' ? 'Us (proactive)' : 'Buyer (reactive)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Planned resolution</Label>
                  <Input
                    value={plannedResolution}
                    onChange={(e) => setPlannedResolution(e.target.value)}
                    placeholder="e.g. Refund missing lots"
                  />
                </div>
              </div>

              {items.length > 0 && (
                <div>
                  <Label>Affected lots</Label>
                  <div className="border rounded mt-1 max-h-[300px] overflow-y-auto">
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
                                  updateItem(idx, {
                                    qty_expected: Number(e.target.value) || 0,
                                  })
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
                                  updateItem(idx, {
                                    qty_received: Number(e.target.value) || 0,
                                  })
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
                </div>
              )}
            </>
          )}

          {createMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{createMutation.error.message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canSave || createMutation.isPending}
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Create issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
