'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Save,
  MessageSquarePlus,
  Mail,
  Globe,
  Hand,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { AddIssueItemsDialog } from '@/components/features/order-issues/AddIssueItemsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  getOrderIssue,
  updateOrderIssue,
  deleteOrderIssue,
  deleteOrderIssueItem,
  addOrderIssueMessage,
  syncOrderIssueGmail,
} from '@/lib/api/order-issues';
import {
  ORDER_ISSUE_STATUSES,
  type OrderIssueStatus,
  type OrderIssueMessageDirection,
} from '@/lib/schemas/order-issue.schema';

const STATUS_LABELS: Record<OrderIssueStatus, string> = {
  open: 'Open',
  awaiting_buyer: 'Awaiting buyer',
  awaiting_us: 'Awaiting us',
  resolved_refund: 'Resolved (refund)',
  resolved_replacement: 'Resolved (replacement)',
  resolved_partial: 'Resolved (partial)',
  resolved_credit: 'Resolved (credit)',
  closed_no_action: 'Closed (no action)',
};

const SOURCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  gmail: Mail,
  bricklink: Globe,
  brickowl: Globe,
  bricqer: Globe,
  manual: Hand,
};

export default function OrderIssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['order-issue', id],
    queryFn: () => getOrderIssue(id),
  });

  const [statusEdit, setStatusEdit] = useState<OrderIssueStatus | null>(null);
  const [resolutionEdit, setResolutionEdit] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState<string | null>(null);
  const [replacementQty, setReplacementQty] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState<string | null>(null);

  const [newMessageBody, setNewMessageBody] = useState('');
  const [newMessageDirection, setNewMessageDirection] =
    useState<OrderIssueMessageDirection>('inbound');
  const [addItemsOpen, setAddItemsOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateOrderIssue(id, {
        issue_status: statusEdit ?? undefined,
        planned_resolution: resolutionEdit ?? undefined,
        refund_amount: refundAmount === null || refundAmount === '' ? undefined : Number(refundAmount),
        replacement_qty:
          replacementQty === null || replacementQty === '' ? undefined : Number(replacementQty),
        credit_amount:
          creditAmount === null || creditAmount === '' ? undefined : Number(creditAmount),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order-issue', id] });
      qc.invalidateQueries({ queryKey: ['order-issues'] });
      setStatusEdit(null);
      setResolutionEdit(null);
      setRefundAmount(null);
      setReplacementQty(null);
      setCreditAmount(null);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => deleteOrderIssueItem(id, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order-issue', id] }),
  });

  const deleteIssueMutation = useMutation({
    mutationFn: () => deleteOrderIssue(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order-issues'] });
      router.push('/order-issues');
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncOrderIssueGmail(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order-issue', id] }),
  });

  const addMessageMutation = useMutation({
    mutationFn: () =>
      addOrderIssueMessage(id, {
        source: 'manual',
        direction: newMessageDirection,
        sent_at: new Date().toISOString(),
        body: newMessageBody,
      }),
    onSuccess: () => {
      setNewMessageBody('');
      qc.invalidateQueries({ queryKey: ['order-issue', id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container mx-auto py-6">
        <Alert variant="destructive">
          <AlertDescription>Issue not found.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { issue, items, messages } = data;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/order-issues">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">
            {issue.platform === 'bricklink' ? 'BrickLink' : 'BrickOwl'} Order #
            {issue.platform_order_id}
          </h1>
          <p className="text-sm text-muted-foreground">
            {issue.buyer_name ?? '—'} &middot;{' '}
            {issue.order_date ? new Date(issue.order_date).toLocaleDateString('en-GB') : '—'}{' '}
            &middot; Discovered by {issue.discovered_by === 'us' ? 'us' : 'buyer'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          title="Pull latest Gmail messages for this order"
        >
          {syncMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1 hidden sm:inline">Sync Gmail</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm('Delete this issue and all items/messages?')) {
              deleteIssueMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status / Resolution editor */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Status &amp; resolution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Status</Label>
              <Select
                value={statusEdit ?? issue.issue_status}
                onValueChange={(v: string) => setStatusEdit(v as OrderIssueStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_ISSUE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Planned resolution</Label>
              <Textarea
                value={resolutionEdit ?? issue.planned_resolution ?? ''}
                onChange={(e) => setResolutionEdit(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Refund £</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={refundAmount ?? issue.refund_amount ?? ''}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Replace qty</Label>
                <Input
                  type="number"
                  value={replacementQty ?? issue.replacement_qty ?? ''}
                  onChange={(e) => setReplacementQty(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Credit £</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={creditAmount ?? issue.credit_amount ?? ''}
                  onChange={(e) => setCreditAmount(e.target.value)}
                />
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              className="w-full"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
            <Badge variant="outline" className="w-full justify-center">
              Currently: {STATUS_LABELS[issue.issue_status as OrderIssueStatus]}
            </Badge>
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Affected lots ({items.length})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAddItemsOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add lots
            </Button>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items recorded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr className="border-b">
                    <th className="py-2">Item</th>
                    <th className="py-2">Colour</th>
                    <th className="py-2 text-right">Exp</th>
                    <th className="py-2 text-right">Rec</th>
                    <th className="py-2 text-right">Missing</th>
                    <th className="py-2">Type</th>
                    <th className="py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b">
                      <td className="py-2">
                        <div className="font-mono text-xs">{it.item_number}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {it.item_name}
                        </div>
                      </td>
                      <td className="py-2 text-xs">{it.color_name ?? '—'}</td>
                      <td className="py-2 text-right">{it.qty_expected}</td>
                      <td className="py-2 text-right">{it.qty_received}</td>
                      <td className="py-2 text-right font-medium">{it.qty_missing}</td>
                      <td className="py-2 text-xs">{it.issue_type.replace(/_/g, ' ')}</td>
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteItemMutation.mutate(it.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <AddIssueItemsDialog
        open={addItemsOpen}
        onOpenChange={setAddItemsOpen}
        issueId={issue.id}
        platform={issue.platform as 'bricklink' | 'brickowl'}
        platformOrderId={issue.platform_order_id}
        existingOrderItemIds={items.map((it) => it.order_item_id).filter((x): x is string => !!x)}
      />

      {/* Messages */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages ({messages.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No messages yet. Automated ingestion will pull buyer/seller messages here.
              </p>
            ) : (
              messages
                .filter((m) => !m.duplicate_of_id)
                .map((m) => {
                  const Icon = SOURCE_ICON[m.source] ?? Hand;
                  return (
                    <div
                      key={m.id}
                      className={`border-l-4 pl-3 py-1 ${
                        m.direction === 'inbound'
                          ? 'border-blue-500 bg-blue-50/50'
                          : 'border-emerald-500 bg-emerald-50/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Icon className="h-3 w-3" />
                        <span className="capitalize font-medium">{m.source}</span>
                        <span>·</span>
                        <span>{m.direction === 'inbound' ? 'From buyer' : 'From us'}</span>
                        <span>·</span>
                        <span>{new Date(m.sent_at).toLocaleString('en-GB')}</span>
                      </div>
                      {m.subject && (
                        <div className="text-sm font-medium mt-1">{m.subject}</div>
                      )}
                      <div className="text-sm whitespace-pre-wrap mt-1">{m.body ?? ''}</div>
                    </div>
                  );
                })
            )}
          </div>

          {/* Add manual message */}
          <div className="border-t pt-4 space-y-2">
            <Label className="flex items-center gap-1">
              <MessageSquarePlus className="h-4 w-4" />
              Log a manual message
            </Label>
            <div className="flex gap-2">
              <Select
                value={newMessageDirection}
                onValueChange={(v: string) =>
                  setNewMessageDirection(v as OrderIssueMessageDirection)
                }
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">From buyer</SelectItem>
                  <SelectItem value="outbound">From us</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                value={newMessageBody}
                onChange={(e) => setNewMessageBody(e.target.value)}
                placeholder="Paste or type message body…"
                rows={3}
                className="flex-1"
              />
            </div>
            <Button
              size="sm"
              onClick={() => addMessageMutation.mutate()}
              disabled={!newMessageBody.trim() || addMessageMutation.isPending}
            >
              {addMessageMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              )}
              Add message
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
