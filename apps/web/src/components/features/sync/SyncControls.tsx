'use client';

import { RefreshCw, CloudOff, AlertTriangle } from 'lucide-react';
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
 */
export function SyncControls({ compact = false, table }: SyncControlsProps) {
  const { status: globalStatus, tables, isSyncing, lastError } = useGlobalSyncStatus();
  const { syncAll } = useSyncAll();
  const inventorySync = useSyncTable('inventory');
  const purchasesSync = useSyncTable('purchases');

  if (compact) {
    // Compact inline version
    return (
      <div className="flex items-center gap-2">
        {table ? (
          <>
            <SyncStatusBadge
              status={tables[table]}
              showTime
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (table === 'inventory' ? inventorySync.sync() : purchasesSync.sync())}
              disabled={table === 'inventory' ? inventorySync.isPending : purchasesSync.isPending}
            >
              <RefreshCw
                className={`h-4 w-4 ${(table === 'inventory' ? inventorySync.isPending : purchasesSync.isPending) ? 'animate-spin' : ''}`}
              />
            </Button>
          </>
        ) : (
          <>
            <SyncStatusBadge
              status={{
                lastSync: tables.inventory.lastSync,
                status: globalStatus,
                recordCount:
                  (tables.inventory?.recordCount || 0) +
                  (tables.purchases?.recordCount || 0),
              }}
              showTime
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={syncAll}
              disabled={isSyncing}
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </Button>
          </>
        )}
      </div>
    );
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
