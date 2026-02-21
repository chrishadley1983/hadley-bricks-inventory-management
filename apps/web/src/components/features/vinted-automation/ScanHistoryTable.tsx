/**
 * Scan History Table
 *
 * Shows history of automated scans with status and results
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  useScanHistory,
  type ScanLogEntry,
  type ScanHistoryFilters,
} from '@/hooks/use-vinted-automation';
import {
  History,
  Search,
  Target,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  AlertCircle,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ScanDetailDialog } from './ScanDetailDialog';

function getStatusBadge(status: ScanLogEntry['status']) {
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-green-600">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Success
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    case 'partial':
      return (
        <Badge className="bg-yellow-500">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Partial
        </Badge>
      );
    case 'captcha':
      return (
        <Badge className="bg-orange-500">
          <ShieldAlert className="mr-1 h-3 w-3" />
          CAPTCHA
        </Badge>
      );
  }
}

function getScanTypeIcon(scanType: ScanLogEntry['scan_type']) {
  if (scanType === 'broad_sweep') {
    return <Search className="h-4 w-4 text-blue-500" />;
  }
  return <Target className="h-4 w-4 text-purple-500" />;
}

export function ScanHistoryTable() {
  const [filters, setFilters] = useState<ScanHistoryFilters>({
    limit: 50,
  });
  const [selectedScan, setSelectedScan] = useState<ScanLogEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, error } = useScanHistory(filters);

  const handleRowClick = (scan: ScanLogEntry) => {
    setSelectedScan(scan);
    setDialogOpen(true);
  };

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <span>Failed to load scan history</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const scans = data?.scans ?? [];

  // Calculate summary stats
  const successCount = scans.filter((s) => s.status === 'success').length;
  const failureCount = scans.filter((s) => s.status === 'failed' || s.status === 'captcha').length;
  const successRate = scans.length > 0 ? ((successCount / scans.length) * 100).toFixed(0) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Scan History
            </CardTitle>
            <CardDescription>
              {scans.length > 0 && (
                <span>
                  {successCount} successful • {failureCount} failed • {successRate}% success rate
                </span>
              )}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={filters.scanType || 'all'}
              onValueChange={(value: string) =>
                setFilters((f) => ({
                  ...f,
                  scanType: value === 'all' ? undefined : (value as ScanHistoryFilters['scanType']),
                }))
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Scan type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="broad_sweep">Broad Sweep</SelectItem>
                <SelectItem value="watchlist">Watchlist</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.status || 'all'}
              onValueChange={(value: string) =>
                setFilters((f) => ({
                  ...f,
                  status: value === 'all' ? undefined : (value as ScanHistoryFilters['status']),
                }))
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="captcha">CAPTCHA</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ScanHistoryTableSkeleton />
        ) : scans.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No scan history found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Listings</TableHead>
                <TableHead className="text-right">Opportunities</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.map((scan) => (
                <TableRow
                  key={scan.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(scan)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getScanTypeIcon(scan.scan_type)}
                      <span className="text-sm">
                        {scan.scan_type === 'broad_sweep' ? 'Broad' : 'Watchlist'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{scan.set_number || '-'}</TableCell>
                  <TableCell>{getStatusBadge(scan.status)}</TableCell>
                  <TableCell className="text-right">{scan.listings_found}</TableCell>
                  <TableCell className="text-right">
                    {scan.opportunities_found > 0 ? (
                      <span className="font-medium text-green-600">{scan.opportunities_found}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {scan.timing_delay_ms ? `${(scan.timing_delay_ms / 1000).toFixed(1)}s` : '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div
                      title={
                        scan.completed_at ? format(new Date(scan.completed_at), 'PPpp') : undefined
                      }
                    >
                      {scan.completed_at
                        ? formatDistanceToNow(new Date(scan.completed_at), {
                            addSuffix: true,
                          })
                        : 'In progress'}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {scan.error_message && (
                      <span
                        className="text-xs text-red-600 truncate block"
                        title={scan.error_message}
                      >
                        {scan.error_message}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <ScanDetailDialog scan={selectedScan} open={dialogOpen} onOpenChange={setDialogOpen} />
      </CardContent>
    </Card>
  );
}

function ScanHistoryTableSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(10)].map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
