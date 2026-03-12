'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import {
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Settings,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

// ---- Types ----

interface Proposal {
  id: string;
  inventory_item_id: string;
  platform: string;
  diagnosis: string;
  diagnosis_reason: string;
  current_price: number;
  proposed_price: number | null;
  price_floor: number;
  market_price: number | null;
  proposed_action: string;
  markdown_step: number | null;
  aging_days: number;
  auction_end_date: string | null;
  auction_duration_days: number | null;
  status: string;
  error_message: string | null;
  set_number: string | null;
  item_name: string | null;
  sales_rank: number | null;
  created_at: string;
}

interface ProposalSummary {
  pending: number;
  approved: number;
  rejected: number;
  autoApplied: number;
  failed: number;
  markdowns: number;
  auctions: number;
}

interface Config {
  mode: string;
  amazon_step1_days: number;
  amazon_step2_days: number;
  amazon_step3_days: number;
  amazon_step4_days: number;
  ebay_step1_days: number;
  ebay_step2_days: number;
  ebay_step3_days: number;
  ebay_step4_days: number;
  amazon_step2_undercut_pct: number;
  amazon_step3_undercut_pct: number;
  ebay_step1_reduction_pct: number;
  ebay_step2_reduction_pct: number;
  overpriced_threshold_pct: number;
  low_demand_sales_rank: number;
  auction_default_duration_days: number;
  auction_max_per_day: number;
  auction_enabled: boolean;
}

// ---- Hooks ----

function useProposals(page: number, filters: Record<string, string | null>) {
  return useQuery({
    queryKey: ['markdown', 'proposals', page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (filters.status) params.set('status', filters.status);
      if (filters.platform) params.set('platform', filters.platform);
      if (filters.diagnosis) params.set('diagnosis', filters.diagnosis);
      if (filters.action) params.set('action', filters.action);
      const res = await fetch(`/api/markdown/proposals?${params}`);
      if (!res.ok) throw new Error('Failed to fetch proposals');
      return res.json() as Promise<{
        data: Proposal[];
        summary: ProposalSummary;
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>;
    },
  });
}

function useConfig() {
  return useQuery({
    queryKey: ['markdown', 'config'],
    queryFn: async () => {
      const res = await fetch('/api/markdown/config');
      if (!res.ok) throw new Error('Failed to fetch config');
      return res.json() as Promise<Config>;
    },
  });
}

function useApproveProposal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/markdown/proposals/${id}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to approve');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['markdown'] });
      toast({ title: 'Proposal approved', description: 'Price updated successfully' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });
}

function useRejectProposal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/markdown/proposals/${id}/reject`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reject');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['markdown'] });
      toast({ title: 'Proposal rejected' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });
}

function useBulkAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (actions: Array<{ id: string; action: 'approve' | 'reject' }>) => {
      const res = await fetch('/api/markdown/proposals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      });
      if (!res.ok) throw new Error('Bulk action failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['markdown'] });
      toast({
        title: 'Bulk action complete',
        description: `Approved: ${data.approved}, Rejected: ${data.rejected}${data.failed ? `, Failed: ${data.failed}` : ''}`,
      });
    },
    onError: (err) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });
}

function useUpdateConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (config: Partial<Config>) => {
      const res = await fetch('/api/markdown/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to update config');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['markdown', 'config'] });
      toast({ title: 'Config updated' });
    },
  });
}

function useRunScan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/cron/markdown', { method: 'POST' });
      if (!res.ok) throw new Error('Scan failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['markdown'] });
      toast({
        title: 'Scan complete',
        description: `${data.proposalsCreated} proposals created (${data.autoApplied} auto-applied)`,
      });
    },
    onError: (err) => {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    },
  });
}

// ---- Components ----

function DiagnosisBadge({ diagnosis }: { diagnosis: string }) {
  if (diagnosis === 'OVERPRICED') {
    return <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50">Overpriced</Badge>;
  }
  if (diagnosis === 'LOW_DEMAND') {
    return <Badge variant="outline" className="border-red-500 text-red-700 bg-red-50">Low Demand</Badge>;
  }
  return <Badge variant="secondary">{diagnosis}</Badge>;
}

function ActionBadge({ action }: { action: string }) {
  if (action === 'MARKDOWN') {
    return <Badge variant="outline" className="border-blue-500 text-blue-700 bg-blue-50">Markdown</Badge>;
  }
  if (action === 'AUCTION') {
    return <Badge variant="outline" className="border-purple-500 text-purple-700 bg-purple-50">Auction</Badge>;
  }
  return <Badge variant="secondary">{action}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    PENDING: 'border-yellow-500 text-yellow-700 bg-yellow-50',
    APPROVED: 'border-green-500 text-green-700 bg-green-50',
    REJECTED: 'border-gray-500 text-gray-700 bg-gray-50',
    AUTO_APPLIED: 'border-green-500 text-green-700 bg-green-50',
    FAILED: 'border-red-500 text-red-700 bg-red-50',
  };
  return (
    <Badge variant="outline" className={variants[status] || ''}>
      {status === 'AUTO_APPLIED' ? 'Auto' : status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <Badge variant="secondary" className="text-xs">
      {platform === 'amazon' ? 'AMZ' : 'eBay'}
    </Badge>
  );
}

// ---- Main Page ----

export default function MarkdownPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string | null>>({
    status: 'PENDING',
    platform: null,
    diagnosis: null,
    action: null,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: proposalData, isLoading } = useProposals(page, filters);
  const { data: config } = useConfig();
  const approveMutation = useApproveProposal();
  const rejectMutation = useRejectProposal();
  const bulkMutation = useBulkAction();
  const updateConfig = useUpdateConfig();
  const runScan = useRunScan();

  const summary = proposalData?.summary;
  const proposals = proposalData?.data || [];
  const pagination = proposalData?.pagination;

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === proposals.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(proposals.filter((p) => p.status === 'PENDING').map((p) => p.id)));
    }
  };

  const handleBulkApprove = () => {
    if (selected.size === 0) return;
    bulkMutation.mutate(
      Array.from(selected).map((id) => ({ id, action: 'approve' as const }))
    );
    setSelected(new Set());
  };

  const handleBulkReject = () => {
    if (selected.size === 0) return;
    bulkMutation.mutate(
      Array.from(selected).map((id) => ({ id, action: 'reject' as const }))
    );
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Smart Markdown</h1>
          <p className="text-muted-foreground">
            Automated price management for aged inventory
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runScan.mutate()}
            disabled={runScan.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${runScan.isPending ? 'animate-spin' : ''}`} />
            Run Scan
          </Button>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Markdown Settings</DialogTitle>
                <DialogDescription>
                  Configure markdown mode and thresholds
                </DialogDescription>
              </DialogHeader>
              {config && (
                <div className="space-y-6 pt-4">
                  {/* Mode toggle */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">Auto Mode</Label>
                      <p className="text-sm text-muted-foreground">
                        {config.mode === 'auto'
                          ? 'Overpriced items are repriced automatically. Auction proposals still require approval.'
                          : 'All proposals require manual approval before any price changes.'}
                      </p>
                    </div>
                    <Switch
                      checked={config.mode === 'auto'}
                      onCheckedChange={(checked: boolean) =>
                        updateConfig.mutate({ mode: checked ? 'auto' : 'review' })
                      }
                    />
                  </div>

                  {/* Auction toggle */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">Auction Exit</Label>
                      <p className="text-sm text-muted-foreground">
                        Recommend eBay auctions for low-demand items
                      </p>
                    </div>
                    <Switch
                      checked={config.auction_enabled}
                      onCheckedChange={(checked: boolean) =>
                        updateConfig.mutate({ auction_enabled: checked })
                      }
                    />
                  </div>

                  {/* Key thresholds */}
                  <div className="space-y-3">
                    <Label className="text-base">Thresholds</Label>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Overpriced trigger</span>
                        <p className="font-medium">&gt;{config.overpriced_threshold_pct}% above market</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Low demand rank</span>
                        <p className="font-medium">&gt;{config.low_demand_sales_rank?.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Auction duration</span>
                        <p className="font-medium">{config.auction_default_duration_days} days</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Max auctions/day</span>
                        <p className="font-medium">{config.auction_max_per_day}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pending Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{summary.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Auto-Applied
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{summary.autoApplied}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Approved
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{summary.approved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Rejected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-600">{summary.rejected}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mode indicator */}
      {config && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Mode:</span>
          <Badge variant={config.mode === 'auto' ? 'default' : 'secondary'}>
            {config.mode === 'auto' ? 'Auto' : 'Review'}
          </Badge>
          {config.auction_enabled && (
            <Badge variant="outline" className="border-purple-500 text-purple-700">
              Auctions Enabled
            </Badge>
          )}
        </div>
      )}

      {/* Filters + Bulk Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.status || 'all'}
          onValueChange={(v: string) => {
            setFilters((f) => ({ ...f, status: v === 'all' ? null : v }));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="AUTO_APPLIED">Auto-Applied</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.platform || 'all'}
          onValueChange={(v: string) => {
            setFilters((f) => ({ ...f, platform: v === 'all' ? null : v }));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="amazon">Amazon</SelectItem>
            <SelectItem value="ebay">eBay</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.diagnosis || 'all'}
          onValueChange={(v: string) => {
            setFilters((f) => ({ ...f, diagnosis: v === 'all' ? null : v }));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Diagnosis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Diagnoses</SelectItem>
            <SelectItem value="OVERPRICED">Overpriced</SelectItem>
            <SelectItem value="LOW_DEMAND">Low Demand</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.action || 'all'}
          onValueChange={(v: string) => {
            setFilters((f) => ({ ...f, action: v === 'all' ? null : v }));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="MARKDOWN">Markdown</SelectItem>
            <SelectItem value="AUCTION">Auction</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex gap-2">
          {selected.size > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-green-700"
                onClick={handleBulkApprove}
                disabled={bulkMutation.isPending}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Approve ({selected.size})
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-700"
                onClick={handleBulkReject}
                disabled={bulkMutation.isPending}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Reject ({selected.size})
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Proposals Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6">
              <Skeleton className="h-64" />
            </div>
          ) : proposals.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <TrendingDown className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No proposals found</p>
              <p className="text-sm mt-1">Run a scan to evaluate aged inventory</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size > 0 && selected.size === proposals.filter((p) => p.status === 'PENDING').length}
                      onCheckedChange={selectAll}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Diagnosis</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Proposed</TableHead>
                  <TableHead className="text-right">Saving</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => {
                  const saving = p.proposed_price
                    ? p.current_price - p.proposed_price
                    : null;
                  const savingPct = saving
                    ? ((saving / p.current_price) * 100).toFixed(0)
                    : null;

                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        {p.status === 'PENDING' && (
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={() => toggleSelected(p.id)}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">
                          {p.set_number && (
                            <span className="text-muted-foreground mr-1">{p.set_number}</span>
                          )}
                          {p.item_name || 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 max-w-[250px] truncate" title={p.diagnosis_reason}>
                          {p.diagnosis_reason}
                        </div>
                      </TableCell>
                      <TableCell>
                        <PlatformBadge platform={p.platform} />
                      </TableCell>
                      <TableCell>
                        <DiagnosisBadge diagnosis={p.diagnosis} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        £{p.current_price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {p.proposed_price ? (
                          <span className="text-green-700">£{p.proposed_price.toFixed(2)}</span>
                        ) : (
                          <span className="text-purple-700">Auction</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {saving ? (
                          <span className="text-red-600">
                            -£{saving.toFixed(2)} ({savingPct}%)
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{p.aging_days}d</TableCell>
                      <TableCell>
                        <ActionBadge action={p.proposed_action} />
                        {p.proposed_action === 'AUCTION' && p.auction_end_date && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Ends {new Date(p.auction_end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {p.status === 'PENDING' && (
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-green-700 hover:text-green-800 hover:bg-green-50"
                              onClick={() => approveMutation.mutate(p.id)}
                              disabled={approveMutation.isPending}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-700 hover:text-red-800 hover:bg-red-50"
                              onClick={() => rejectMutation.mutate(p.id)}
                              disabled={rejectMutation.isPending}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        {p.status === 'FAILED' && p.error_message && (
                          <span className="text-xs text-red-600" title={p.error_message}>
                            <AlertTriangle className="h-3.5 w-3.5 inline" />
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {pagination.total} proposals — page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
