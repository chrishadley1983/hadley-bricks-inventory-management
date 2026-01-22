/**
 * Connection Status Card
 *
 * DCS1-DCS5: Dashboard connection status for Windows tray application
 *
 * Shows:
 * - Connection status (connected/disconnected)
 * - Machine name
 * - Current status (running/paused/error/outside_hours)
 * - Scans and opportunities today
 * - Last heartbeat time
 * - Troubleshooting tips when disconnected
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, differenceInMinutes } from 'date-fns';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  CheckCircle2,
  Computer,
  Clock,
  ScanLine,
  Target,
  XCircle,
} from 'lucide-react';
import type { ConnectionStatus } from '@/types/vinted-automation';

/**
 * Threshold for considering the connection as disconnected (in minutes)
 * DCS4: Warning after 10 minutes no heartbeat
 */
const DISCONNECTION_THRESHOLD_MINUTES = 10;

/**
 * Extended connection status with listings
 */
interface ExtendedConnectionStatus extends ConnectionStatus {
  listingsToday: number;
}

/**
 * Fetch connection status from the API
 */
async function fetchConnectionStatus(): Promise<ExtendedConnectionStatus> {
  const response = await fetch('/api/arbitrage/vinted/automation');
  if (!response.ok) {
    throw new Error('Failed to fetch connection status');
  }
  const data = await response.json();

  // Extract connection status from the scanner config
  // Use todayStats for accurate listings/opportunities counts from scan logs
  return {
    connected: !!data.config?.last_heartbeat_at &&
      differenceInMinutes(new Date(), new Date(data.config.last_heartbeat_at)) < DISCONNECTION_THRESHOLD_MINUTES,
    lastSeenAt: data.config?.last_heartbeat_at ? new Date(data.config.last_heartbeat_at) : undefined,
    machineId: data.config?.heartbeat_machine_id,
    machineName: data.config?.machine_name,
    status: data.config?.heartbeat_status || 'disconnected',
    scansToday: (data.todayStats?.broadSweeps ?? 0) + (data.todayStats?.watchlistScans ?? 0),
    listingsToday: data.todayStats?.listings ?? 0,
    opportunitiesToday: data.todayStats?.opportunities ?? 0,
    lastScanAt: data.config?.last_scan_at ? new Date(data.config.last_scan_at) : undefined,
  };
}

/**
 * Status badge component
 */
function StatusBadge({ status }: { status: ConnectionStatus['status'] }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    running: { variant: 'default', label: 'Running' },
    paused: { variant: 'secondary', label: 'Paused' },
    error: { variant: 'destructive', label: 'Error' },
    outside_hours: { variant: 'outline', label: 'Outside Hours' },
    disconnected: { variant: 'destructive', label: 'Disconnected' },
  };

  const config = variants[status || 'disconnected'] || variants.disconnected;

  return (
    <Badge variant={config.variant} className="ml-2">
      {config.label}
    </Badge>
  );
}

export function ConnectionStatusCard() {
  const { data: status, isLoading, error } = useQuery({
    queryKey: ['vinted-connection-status'],
    queryFn: fetchConnectionStatus,
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Computer className="h-5 w-5" />
            Local Scanner Status
          </CardTitle>
          <CardDescription>Loading connection status...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="h-5 w-5" />
            Connection Error
          </CardTitle>
          <CardDescription>Failed to load connection status</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // DCS3: Check if disconnected (no heartbeat for 10+ minutes)
  const isDisconnected = !status?.connected;

  // DCS5: Show troubleshooting when disconnected
  if (isDisconnected) {
    return (
      <Card className="border-yellow-200 dark:border-yellow-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow-600">
            <AlertTriangle className="h-5 w-5" />
            Local Scanner Not Connected
            <StatusBadge status="disconnected" />
          </CardTitle>
          <CardDescription>
            {status?.lastSeenAt
              ? `Last seen ${formatDistanceToNow(status.lastSeenAt, { addSuffix: true })}`
              : 'Never connected'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The Windows scanner application is not sending heartbeats.
            </p>
            <div className="rounded-md bg-yellow-50 dark:bg-yellow-950 p-3">
              <h4 className="text-sm font-medium mb-2">Troubleshooting:</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                <li>Ensure your PC is powered on and not in sleep mode</li>
                <li>Check if Hadley Bricks Scanner is running (look for the tray icon)</li>
                <li>Right-click the tray icon and select &quot;Resume&quot; if paused</li>
                <li>Verify your internet connection is working</li>
                <li>Try restarting the scanner application</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // DCS1: Show connected status with stats
  return (
    <Card className="border-green-200 dark:border-green-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          Local Scanner Connected
          <StatusBadge status={status?.status} />
        </CardTitle>
        <CardDescription>
          {status?.machineName || status?.machineId || 'Unknown machine'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* Last Heartbeat */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Last Heartbeat</p>
              <p className="text-sm font-medium">
                {status?.lastSeenAt
                  ? formatDistanceToNow(status.lastSeenAt, { addSuffix: true })
                  : 'N/A'}
              </p>
            </div>
          </div>

          {/* Last Scan */}
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Last Scan</p>
              <p className="text-sm font-medium">
                {status?.lastScanAt
                  ? formatDistanceToNow(status.lastScanAt, { addSuffix: true })
                  : 'N/A'}
              </p>
            </div>
          </div>

          {/* Scans Today */}
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Scans Today</p>
              <p className="text-sm font-medium">{status?.scansToday ?? 0}</p>
            </div>
          </div>

          {/* Listings Today */}
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Listings</p>
              <p className="text-sm font-medium">{status?.listingsToday ?? 0}</p>
            </div>
          </div>

          {/* Opportunities Today */}
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Opportunities</p>
              <p className="text-sm font-medium">{status?.opportunitiesToday ?? 0}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
