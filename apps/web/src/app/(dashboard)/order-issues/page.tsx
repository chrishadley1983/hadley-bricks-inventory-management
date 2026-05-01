'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listOrderIssues } from '@/lib/api/order-issues';
import type { OrderIssuePlatform } from '@/lib/schemas/order-issue.schema';
import { NewOrderIssueDialog } from '@/components/features/order-issues/NewOrderIssueDialog';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  awaiting_buyer: 'Awaiting buyer',
  awaiting_us: 'Awaiting us',
  resolved_refund: 'Resolved (refund)',
  resolved_replacement: 'Resolved (replacement)',
  resolved_partial: 'Resolved (partial)',
  resolved_credit: 'Resolved (credit)',
  closed_no_action: 'Closed (no action)',
};

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'destructive',
  awaiting_buyer: 'secondary',
  awaiting_us: 'destructive',
  resolved_refund: 'outline',
  resolved_replacement: 'outline',
  resolved_partial: 'outline',
  resolved_credit: 'outline',
  closed_no_action: 'outline',
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function ageBadge(days: number | null) {
  if (days === null) return <span className="text-muted-foreground text-xs">—</span>;
  const colour =
    days < 2
      ? 'bg-emerald-100 text-emerald-800'
      : days < 7
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${colour}`}>
      {days}d
    </span>
  );
}

export default function OrderIssuesPage() {
  const [openOnly, setOpenOnly] = useState(true);
  const [platform, setPlatform] = useState<'all' | OrderIssuePlatform>('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['order-issues', { openOnly, platform }],
    queryFn: () =>
      listOrderIssues({
        openOnly,
        platform: platform === 'all' ? undefined : platform,
        pageSize: 100,
      }),
  });

  const rows = data?.data ?? [];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            Order Issues
          </h1>
          <p className="text-sm text-muted-foreground">
            Track buyer-side issues on BrickLink and BrickOwl orders.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New issue
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="open-only"
                checked={openOnly}
                onCheckedChange={(v: boolean) => setOpenOnly(Boolean(v))}
              />
              <Label htmlFor="open-only" className="text-sm">
                Open only
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Platform</Label>
              <Select
                value={platform}
                onValueChange={(v: string) => setPlatform(v as 'all' | OrderIssuePlatform)}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="bricklink">BrickLink</SelectItem>
                  <SelectItem value="brickowl">BrickOwl</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto text-sm text-muted-foreground">
              {data?.pagination.total ?? 0} {data?.pagination.total === 1 ? 'issue' : 'issues'}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <div className="text-sm text-red-600 py-6">
              Failed to load order issues.{' '}
              <button onClick={() => refetch()} className="underline">
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState openOnly={openOnly} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order date</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Order #</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead>Latest message</TableHead>
                  <TableHead>Resolution</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Days open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const daysOpen = daysSince(row.created_at);
                  const messageAgeDays = daysSince(row.latest_message_at);
                  return (
                    <TableRow key={row.id} className="cursor-pointer">
                      <TableCell>
                        <Link href={`/order-issues/${row.id}`} className="hover:underline block">
                          {row.order_date
                            ? new Date(row.order_date).toLocaleDateString('en-GB')
                            : '—'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/order-issues/${row.id}`} className="hover:underline">
                          <Badge variant="outline" className="capitalize">
                            {row.platform}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/order-issues/${row.id}`} className="hover:underline">
                          {row.platform_order_id}
                        </Link>
                      </TableCell>
                      <TableCell>{row.buyer_name ?? row.buyer_username ?? '—'}</TableCell>
                      <TableCell className="text-right">{row.item_count}</TableCell>
                      <TableCell className="max-w-[300px]">
                        {row.latest_message_at ? (
                          <div className="flex items-center gap-2">
                            {ageBadge(messageAgeDays)}
                            <span className="truncate text-xs text-muted-foreground">
                              {row.latest_message_preview ?? ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No messages</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {row.planned_resolution ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE_VARIANT[row.issue_status] ?? 'outline'}>
                          {STATUS_LABELS[row.issue_status] ?? row.issue_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{daysOpen ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewOrderIssueDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function EmptyState({ openOnly }: { openOnly: boolean }) {
  return (
    <div className="text-center py-12">
      <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground/50" />
      <p className="mt-2 text-sm font-medium">
        {openOnly ? 'No open issues' : 'No order issues'}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {openOnly
          ? 'All caught up. Toggle "Open only" off to see resolved/closed issues.'
          : 'Create one with the "New issue" button above.'}
      </p>
    </div>
  );
}
