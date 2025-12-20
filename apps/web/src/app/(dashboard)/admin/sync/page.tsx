'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useGlobalSyncStatus, useSyncAll } from '@/hooks';
import { useQuery } from '@tanstack/react-query';

// Dynamic imports for SSR safety
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const SyncControls = dynamic(
  () => import('@/components/features/sync').then((mod) => ({ default: mod.SyncControls })),
  { ssr: false }
);

/** Format a date for display */
function formatDate(date: Date | null): string {
  if (!date) return 'Never';
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  return date.toLocaleDateString();
}

/** Fetch migration stats from the API */
async function fetchMigrationStats(): Promise<{
  sheets: { newKitRows: number; usedKitRows: number; purchasesRows: number };
  supabase: { inventoryNew: number; inventoryUsed: number; purchases: number };
}> {
  const response = await fetch('/api/admin/migration/stats');
  if (!response.ok) {
    throw new Error('Failed to fetch migration stats');
  }
  const result = await response.json();
  return result;
}

export default function AdminSyncPage() {
  const { status, lastSync, isSyncing, lastError } = useGlobalSyncStatus();
  const { syncAll } = useSyncAll();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch current data counts
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['admin', 'migration', 'stats'],
    queryFn: fetchMigrationStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleFullSync = async () => {
    setIsRefreshing(true);
    try {
      await syncAll();
      await refetchStats();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <>
      <Header title="Data Sync" />
      <div className="p-6 space-y-6">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Data Synchronization</h2>
            <p className="text-muted-foreground">
              Manage data sync between Google Sheets and the local database
            </p>
          </div>
          <Button onClick={handleFullSync} disabled={isSyncing || isRefreshing}>
            {isSyncing || isRefreshing ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync All Now
              </>
            )}
          </Button>
        </div>

        {/* Error Alert */}
        {lastError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{lastError}</AlertDescription>
          </Alert>
        )}

        {/* Status Overview */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sync Status</CardTitle>
              {status === 'synced' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              {status === 'syncing' && <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />}
              {status === 'stale' && <Clock className="h-4 w-4 text-yellow-500" />}
              {status === 'error' && <AlertTriangle className="h-4 w-4 text-red-500" />}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold capitalize">{status}</div>
              <p className="text-xs text-muted-foreground">
                Last sync: {formatDate(lastSync)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Database Records</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats
                  ? (stats.supabase.inventoryNew + stats.supabase.inventoryUsed).toLocaleString()
                  : '-'}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats?.supabase.inventoryNew.toLocaleString()} new,{' '}
                {stats?.supabase.inventoryUsed.toLocaleString()} used
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sheet Records</CardTitle>
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats
                  ? (stats.sheets.newKitRows + stats.sheets.usedKitRows).toLocaleString()
                  : '-'}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats?.sheets.newKitRows.toLocaleString()} new,{' '}
                {stats?.sheets.usedKitRows.toLocaleString()} used
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Sync Controls */}
        <SyncControls />

        {/* Data Comparison */}
        {stats && (
          <Card>
            <CardHeader>
              <CardTitle>Data Comparison</CardTitle>
              <CardDescription>
                Compare record counts between Google Sheets and the database
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Inventory New */}
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium">New Kit Inventory</p>
                      <p className="text-sm text-muted-foreground">
                        Items marked as &quot;New&quot; condition
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Sheets</p>
                      <p className="font-medium">{stats.sheets.newKitRows.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Database</p>
                      <p className="font-medium">
                        {stats.supabase.inventoryNew.toLocaleString()}
                      </p>
                    </div>
                    {stats.sheets.newKitRows === stats.supabase.inventoryNew ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Match
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Diff: {Math.abs(stats.sheets.newKitRows - stats.supabase.inventoryNew)}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Inventory Used */}
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium">Used Kit Inventory</p>
                      <p className="text-sm text-muted-foreground">
                        Items marked as &quot;Used&quot; condition
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Sheets</p>
                      <p className="font-medium">{stats.sheets.usedKitRows.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Database</p>
                      <p className="font-medium">
                        {stats.supabase.inventoryUsed.toLocaleString()}
                      </p>
                    </div>
                    {stats.sheets.usedKitRows === stats.supabase.inventoryUsed ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Match
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Diff: {Math.abs(stats.sheets.usedKitRows - stats.supabase.inventoryUsed)}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Purchases */}
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium">Purchases</p>
                      <p className="text-sm text-muted-foreground">
                        Purchase transaction records
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Sheets</p>
                      <p className="font-medium">{stats.sheets.purchasesRows.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Database</p>
                      <p className="font-medium">{stats.supabase.purchases.toLocaleString()}</p>
                    </div>
                    {stats.sheets.purchasesRows === stats.supabase.purchases ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Match
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Diff: {Math.abs(stats.sheets.purchasesRows - stats.supabase.purchases)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Architecture Info */}
        <Card>
          <CardHeader>
            <CardTitle>Sync Architecture</CardTitle>
            <CardDescription>How data synchronization works</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-4">
              <h4 className="font-medium mb-2">Sheets-Primary Architecture</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  <span className="font-medium text-foreground">Source of Truth:</span> Google
                  Sheets
                </li>
                <li>
                  <span className="font-medium text-foreground">Cache:</span> Supabase database
                </li>
                <li>
                  <span className="font-medium text-foreground">TTL:</span> 5 minutes (auto-sync when
                  stale)
                </li>
                <li>
                  <span className="font-medium text-foreground">Conflict Resolution:</span> Sheets
                  always wins
                </li>
              </ul>
            </div>

            <div className="rounded-lg bg-muted p-4">
              <h4 className="font-medium mb-2">Sync Strategy</h4>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Delete all cached records for user</li>
                <li>Fetch all records from Google Sheets</li>
                <li>Transform and validate data</li>
                <li>Insert into Supabase cache</li>
                <li>Update sync metadata</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
