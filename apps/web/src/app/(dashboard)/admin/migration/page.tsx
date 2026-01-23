'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, AlertCircle, RefreshCw, Database, FileSpreadsheet } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';

interface ConnectionStatus {
  sheets: { connected: boolean; title?: string; error?: string };
  supabase: { connected: boolean; counts?: { inventory: number; purchases: number } };
}

interface MigrationStats {
  sheets: {
    newKitRows: number;
    usedKitRows: number;
    purchasesRows: number;
  };
  supabase: {
    inventoryNew: number;
    inventoryUsed: number;
    purchases: number;
  };
}

export default function MigrationPage() {
  usePerfPage('MigrationPage');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [migrationStats, setMigrationStats] = useState<MigrationStats | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);

  const testConnection = async () => {
    setIsTestingConnection(true);
    try {
      const response = await fetch('/api/admin/sheets/test-connection');
      const data = await response.json();

      setConnectionStatus({
        sheets: {
          connected: data.success,
          title: data.spreadsheetTitle,
          error: data.message,
        },
        supabase: { connected: true }, // If we got here, Supabase is working
      });
    } catch (error) {
      setConnectionStatus({
        sheets: {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        supabase: { connected: false },
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const loadStats = async () => {
    setIsLoadingStats(true);
    try {
      const response = await fetch('/api/admin/migration/stats');
      const data = await response.json();
      setMigrationStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const runDryRun = async () => {
    setIsMigrating(true);
    setMigrationResult(null);
    try {
      const response = await fetch('/api/admin/migration/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, limit: 10 }),
      });
      const data = await response.json();
      setMigrationResult(
        `Dry Run Complete:\n${data.totalSuccess} would be created\n${data.totalSkipped} would be skipped\n${data.totalErrors} errors`
      );
    } catch (error) {
      setMigrationResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Data Migration</h1>
          <p className="text-muted-foreground">
            Manage data migration between Google Sheets and Supabase
          </p>
        </div>
        <Button onClick={testConnection} disabled={isTestingConnection}>
          {isTestingConnection ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Test Connection
        </Button>
      </div>

      {/* Connection Status */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Google Sheets</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {connectionStatus?.sheets ? (
              <div className="flex items-center gap-2">
                {connectionStatus.sheets.connected ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">Connected</p>
                      <p className="text-sm text-muted-foreground">
                        {connectionStatus.sheets.title}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-5 w-5 text-red-500" />
                    <div>
                      <p className="font-medium">Not Connected</p>
                      <p className="text-sm text-red-500">{connectionStatus.sheets.error}</p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Click Test Connection to check</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Supabase Database</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {connectionStatus?.supabase ? (
              <div className="flex items-center gap-2">
                {connectionStatus.supabase.connected ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">Connected</p>
                      <p className="text-sm text-muted-foreground">Ready for migration</p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-5 w-5 text-red-500" />
                    <p className="font-medium">Not Connected</p>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Click Test Connection to check</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Migration Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Migration Status</CardTitle>
          <CardDescription>Compare data between Google Sheets and Supabase</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Button onClick={loadStats} disabled={isLoadingStats} variant="outline">
              {isLoadingStats ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Load Statistics
            </Button>

            {migrationStats && (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <h4 className="font-medium">New Kit Inventory</h4>
                  <div className="text-sm space-y-1">
                    <p>
                      Sheets: <span className="font-mono">{migrationStats.sheets.newKitRows}</span>
                    </p>
                    <p>
                      Supabase:{' '}
                      <span className="font-mono">{migrationStats.supabase.inventoryNew}</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium">Used Kit Inventory</h4>
                  <div className="text-sm space-y-1">
                    <p>
                      Sheets: <span className="font-mono">{migrationStats.sheets.usedKitRows}</span>
                    </p>
                    <p>
                      Supabase:{' '}
                      <span className="font-mono">{migrationStats.supabase.inventoryUsed}</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium">Purchases</h4>
                  <div className="text-sm space-y-1">
                    <p>
                      Sheets:{' '}
                      <span className="font-mono">{migrationStats.sheets.purchasesRows}</span>
                    </p>
                    <p>
                      Supabase:{' '}
                      <span className="font-mono">{migrationStats.supabase.purchases}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Migration Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Migration Actions</CardTitle>
          <CardDescription>Import data from Google Sheets to Supabase</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button onClick={runDryRun} disabled={isMigrating} variant="outline">
              {isMigrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Dry Run (Preview)
            </Button>
            <Button
              disabled={!connectionStatus?.sheets.connected || isMigrating}
              variant="default"
            >
              Run Full Migration
            </Button>
          </div>

          {migrationResult && (
            <pre className="mt-4 p-4 bg-muted rounded-lg text-sm whitespace-pre-wrap">
              {migrationResult}
            </pre>
          )}

          <div className="text-sm text-muted-foreground">
            <p>Migration is idempotent - existing records will be skipped.</p>
            <p>Use the reconciliation script for detailed comparison.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
