'use client';

import { RefreshCw, CloudOff, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSyncTable, useSyncAll, useGlobalSyncStatus } from '@/hooks';
import { SyncStatusBadge } from './SyncStatusBadge';

interface SyncControlsProps {
  /** Show as a compact inline control */
  compact?: boolean;
  /** Specific table to show (omit for all) */
  table?: 'inventory' | 'purchases';
}

/**
 * Manual sync controls component
 *
 * NOTE: Google Sheets sync is currently disabled. Supabase is now the source of truth.
 * The sync functionality is preserved for one-time data imports if needed.
 */
export function SyncControls({ compact = false, table }: SyncControlsProps) {
  const { status: globalStatus, tables, isSyncing, lastError } = useGlobalSyncStatus();
  const { syncAll } = useSyncAll();
  const inventorySync = useSyncTable('inventory');
  const purchasesSync = useSyncTable('purchases');

  // Sync is disabled - hide compact controls entirely
  if (compact) {
    return null;
  }

  // Full card version
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Data Sync
        </CardTitle>
        <CardDescription>
          Sync data from Google Sheets to the local database cache
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Automatic sync is disabled. Supabase is now the source of truth. Use
            manual sync below only for one-time data imports from Google Sheets.
          </AlertDescription>
        </Alert>

        {lastError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{lastError}</AlertDescription>
          </Alert>
        )}

        {/* Individual table sync controls */}
        <div className="space-y-3">
          {/* Inventory */}
          {(!table || table === 'inventory') && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-medium">Inventory</p>
                  <p className="text-sm text-muted-foreground">
                    {tables.inventory?.recordCount || 0} items
                  </p>
                </div>
                <SyncStatusBadge status={tables.inventory} showTime />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => inventorySync.sync()}
                disabled={inventorySync.isPending}
              >
                {inventorySync.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Purchases */}
          {(!table || table === 'purchases') && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-medium">Purchases</p>
                  <p className="text-sm text-muted-foreground">
                    {tables.purchases?.recordCount || 0} records
                  </p>
                </div>
                <SyncStatusBadge status={tables.purchases} showTime />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => purchasesSync.sync()}
                disabled={purchasesSync.isPending}
              >
                {purchasesSync.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Sync all button */}
        {!table && (
          <div className="flex justify-end pt-2">
            <Button onClick={syncAll} disabled={isSyncing}>
              {isSyncing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Syncing All...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync All
                </>
              )}
            </Button>
          </div>
        )}

        {/* Connection warning */}
        {globalStatus === 'error' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CloudOff className="h-4 w-4" />
            <span>Some syncs failed. Check your Google Sheets connection.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
