/**
 * Scanner Control Panel
 *
 * Shows scanner status, enable/disable, pause/resume controls
 */

'use client';

import { useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useScannerStatus,
  useUpdateScannerConfig,
  usePauseScanner,
  useResumeScanner,
  useRegenerateSchedule,
} from '@/hooks/use-vinted-automation';
import {
  Play,
  Pause,
  Power,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Target,
  TrendingUp,
  RefreshCw,
  ShieldAlert,
  Activity,
} from 'lucide-react';
import { formatDistanceToNow, differenceInDays, differenceInHours } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

export function ScannerControlPanel() {
  const { data, isLoading, error } = useScannerStatus();
  const updateConfig = useUpdateScannerConfig();
  const pauseScanner = usePauseScanner();
  const resumeScanner = useResumeScanner();
  const regenerateSchedule = useRegenerateSchedule();
  const { toast } = useToast();

  // Track if we've already shown the CAPTCHA notification
  const captchaNotifiedRef = useRef<string | null>(null);

  // Show browser notification when CAPTCHA is detected
  useEffect(() => {
    const config = data?.config;
    if (!config?.recovery_mode || !config?.captcha_detected_at) return;

    // Only notify once per CAPTCHA detection
    if (captchaNotifiedRef.current === config.captcha_detected_at) return;
    captchaNotifiedRef.current = config.captcha_detected_at;

    // Show toast notification
    toast({
      title: '⚠️ CAPTCHA Detected',
      description: 'Scanner paused. Wait 24-48 hours before resuming for best results.',
      variant: 'destructive',
      duration: 10000,
    });

    // Request browser notification permission and show notification
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('Vinted Scanner - CAPTCHA Detected', {
          body: 'Scanner has been paused. Wait 24-48 hours before resuming.',
          icon: '/favicon.ico',
          tag: 'vinted-captcha',
        });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            new Notification('Vinted Scanner - CAPTCHA Detected', {
              body: 'Scanner has been paused. Wait 24-48 hours before resuming.',
              icon: '/favicon.ico',
              tag: 'vinted-captcha',
            });
          }
        });
      }
    }
  }, [data?.config, toast]);

  if (isLoading) {
    return <ScannerControlPanelSkeleton />;
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <span>Failed to load scanner status</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const config = data?.config;
  const todayStats = data?.todayStats;
  const lastScan = data?.lastScan;

  const isEnabled = config?.enabled ?? false;
  const isPaused = config?.paused ?? false;

  // Determine overall status
  const getStatusInfo = () => {
    if (!isEnabled) {
      return {
        icon: <Power className="h-5 w-5" />,
        label: 'Disabled',
        variant: 'secondary' as const,
        color: 'text-gray-500',
      };
    }
    if (isPaused) {
      return {
        icon: <Pause className="h-5 w-5" />,
        label: 'Paused',
        variant: 'outline' as const,
        color: 'text-yellow-600',
      };
    }
    return {
      icon: <CheckCircle2 className="h-5 w-5" />,
      label: 'Running',
      variant: 'default' as const,
      color: 'text-green-600',
    };
  };

  const statusInfo = getStatusInfo();

  const handleEnableToggle = (enabled: boolean) => {
    updateConfig.mutate({ enabled });
  };

  const handlePauseResume = () => {
    if (isPaused) {
      resumeScanner.mutate();
    } else {
      pauseScanner.mutate('Manually paused');
    }
  };

  const handleRegenerateSchedule = () => {
    regenerateSchedule.mutate(2, {
      onSuccess: (data) => {
        toast({
          title: 'Schedule regenerated',
          description: `${data.scans.length} scans starting in 2 minutes`,
        });
      },
      onError: (error) => {
        toast({
          title: 'Failed to regenerate schedule',
          description: error.message,
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Main Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Scanner Status
                <Badge variant={statusInfo.variant} className="ml-2">
                  <span className={statusInfo.color}>{statusInfo.icon}</span>
                  <span className="ml-1">{statusInfo.label}</span>
                </Badge>
              </CardTitle>
              <CardDescription>
                {config?.pause_reason && (
                  <span className="text-yellow-600">Pause reason: {config.pause_reason}</span>
                )}
              </CardDescription>
            </div>

            <div className="flex items-center gap-4">
              {/* Enable/Disable Toggle */}
              <div className="flex items-center gap-2">
                <Switch
                  id="scanner-enabled"
                  checked={isEnabled}
                  onCheckedChange={handleEnableToggle}
                  disabled={updateConfig.isPending}
                />
                <Label htmlFor="scanner-enabled">{isEnabled ? 'Enabled' : 'Disabled'}</Label>
              </div>

              {/* Pause/Resume Button */}
              {isEnabled && (
                <Button
                  variant={isPaused ? 'default' : 'outline'}
                  onClick={handlePauseResume}
                  disabled={pauseScanner.isPending || resumeScanner.isPending}
                >
                  {isPaused ? (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="mr-2 h-4 w-4" />
                      Pause
                    </>
                  )}
                </Button>
              )}

              {/* Regenerate Schedule Button */}
              {isEnabled && (
                <Button
                  variant="outline"
                  onClick={handleRegenerateSchedule}
                  disabled={regenerateSchedule.isPending}
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${regenerateSchedule.isPending ? 'animate-spin' : ''}`}
                  />
                  Regenerate Schedule
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Operating Hours */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              Operating hours: {config?.operating_hours_start || '08:00'} -{' '}
              {config?.operating_hours_end || '22:00'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* Today's Broad Sweeps */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Search className="h-4 w-4" />
              Broad Sweeps Today
            </CardDescription>
            <CardTitle className="text-2xl">{todayStats?.broadSweeps ?? 0}</CardTitle>
          </CardHeader>
        </Card>

        {/* Today's Watchlist Scans */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Target className="h-4 w-4" />
              Watchlist Scans Today
            </CardDescription>
            <CardTitle className="text-2xl">{todayStats?.watchlistScans ?? 0}</CardTitle>
          </CardHeader>
        </Card>

        {/* Opportunities Found */}
        <Card className={todayStats?.opportunitiesFound ? 'border-green-200 bg-green-50' : ''}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Opportunities Today
            </CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {todayStats?.opportunitiesFound ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Last Scan */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Last Scan
            </CardDescription>
            <CardTitle className="text-lg">
              {lastScan?.completed_at
                ? formatDistanceToNow(new Date(lastScan.completed_at), {
                    addSuffix: true,
                  })
                : 'Never'}
            </CardTitle>
            {lastScan && (
              <p className="text-xs text-muted-foreground mt-1">
                {lastScan.scan_type === 'broad_sweep' ? 'Broad sweep' : 'Watchlist'} •{' '}
                {lastScan.status === 'success' ? (
                  <span className="text-green-600">{lastScan.listings_found} listings</span>
                ) : (
                  <span className="text-red-600">{lastScan.status}</span>
                )}
              </p>
            )}
          </CardHeader>
        </Card>
      </div>

      {/* Recovery Mode Banner */}
      {config?.recovery_mode && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-orange-700">
                <ShieldAlert className="h-5 w-5" />
                <div>
                  <p className="font-medium flex items-center gap-2">
                    Recovery Mode Active
                    <Badge variant="outline" className="text-orange-600 border-orange-300">
                      <Activity className="h-3 w-3 mr-1" />
                      {config.recovery_rate_percent}% Rate
                    </Badge>
                  </p>
                  <p className="text-sm">
                    {config.captcha_detected_at &&
                      (() => {
                        const detectedAt = new Date(config.captcha_detected_at);
                        const daysSince = differenceInDays(new Date(), detectedAt);
                        const hoursSince = differenceInHours(new Date(), detectedAt);
                        const daysUntilFull = Math.max(0, 6 - daysSince);

                        if (daysUntilFull === 0) {
                          return 'Full rate will be restored soon.';
                        }
                        return (
                          `CAPTCHA detected ${hoursSince < 24 ? `${hoursSince}h` : `${daysSince}d`} ago. ` +
                          `Rate increases to ${Math.min(100, config.recovery_rate_percent + 25)}% in ${daysUntilFull > 2 ? `${daysUntilFull} days` : `${daysUntilFull * 24 - (hoursSince % 24)}h`}. ` +
                          `Full rate in ${daysUntilFull} days.`
                        );
                      })()}
                  </p>
                </div>
              </div>
              {config.captcha_count_30d > 1 && (
                <Badge variant="destructive" className="ml-4">
                  {config.captcha_count_30d} CAPTCHAs in 30 days
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* CAPTCHA Warning */}
      {isPaused && config?.pause_reason?.toLowerCase().includes('captcha') && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-yellow-700">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">CAPTCHA Detected - Scanner Paused</p>
                <p className="text-sm">
                  Please open Vinted in your browser and complete the CAPTCHA.
                </p>
                <p className="text-sm mt-1 font-medium text-orange-600">
                  Recommended: Wait 24-48 hours before resuming for best results.
                </p>
                <p className="text-xs mt-1 text-muted-foreground">
                  Recovery mode will start at 25% rate and gradually increase to 100% over 6 days.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Consecutive Failures Warning */}
      {config?.consecutive_failures && config.consecutive_failures >= 3 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">{config.consecutive_failures} Consecutive Failures</p>
                <p className="text-sm">
                  The scanner has failed multiple times. Check the scan history for details.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScannerControlPanelSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-48" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-16 mt-2" />
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
