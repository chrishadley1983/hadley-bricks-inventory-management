/**
 * Schedule Viewer
 *
 * Shows the daily scan schedule in a timeline format
 */

'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useSchedule, useScanHistory, type ScheduledScan } from '@/hooks/use-vinted-automation';
import {
  Calendar,
  Search,
  Target,
  Clock,
  CheckCircle2,
  XCircle,
  Circle,
  AlertCircle,
  Timer,
} from 'lucide-react';
import { format, parse, isAfter, isBefore, addMinutes } from 'date-fns';

interface ScanWithStatus extends ScheduledScan {
  status: 'completed' | 'running' | 'upcoming' | 'missed';
  actualResult?: {
    listings_found: number;
    opportunities_found: number;
    status: string;
  };
}

function getStatusIcon(status: ScanWithStatus['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'running':
      return <Timer className="h-4 w-4 text-blue-500 animate-pulse" />;
    case 'upcoming':
      return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'missed':
      return <XCircle className="h-4 w-4 text-red-500" />;
  }
}

function getStatusBadge(status: ScanWithStatus['status']) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-green-600">Completed</Badge>;
    case 'running':
      return <Badge className="bg-blue-600">Running</Badge>;
    case 'upcoming':
      return <Badge variant="outline">Upcoming</Badge>;
    case 'missed':
      return <Badge variant="destructive">Missed</Badge>;
  }
}

function getScanTypeIcon(type: 'broad_sweep' | 'watchlist') {
  if (type === 'broad_sweep') {
    return <Search className="h-4 w-4 text-blue-500" />;
  }
  return <Target className="h-4 w-4 text-purple-500" />;
}

export function ScheduleViewer() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const { data: schedule, isLoading: scheduleLoading, error: scheduleError } = useSchedule(today);
  const { data: historyData } = useScanHistory({ limit: 100 });

  // Merge schedule with actual scan results
  const scansWithStatus = useMemo<ScanWithStatus[]>(() => {
    if (!schedule?.scans) return [];

    const now = new Date();
    const todayScans =
      historyData?.scans?.filter(
        (s) => s.completed_at && format(new Date(s.completed_at), 'yyyy-MM-dd') === today
      ) ?? [];

    return schedule.scans.map((scan) => {
      // Parse scheduled time to full date
      const scheduledDate = parse(
        `${today} ${scan.scheduledTime}`,
        'yyyy-MM-dd HH:mm:ss',
        new Date()
      );

      // Check if there's a matching completed scan
      const matchingScan = todayScans.find((s) => {
        // Match by type and approximate time (within 5 mins)
        if (s.scan_type !== scan.type) return false;
        if (scan.type === 'watchlist' && s.set_number !== scan.setNumber) return false;

        const completedAt = new Date(s.completed_at!);
        const timeDiff = Math.abs(completedAt.getTime() - scheduledDate.getTime());
        return timeDiff < 10 * 60 * 1000; // 10 minute window
      });

      let status: ScanWithStatus['status'];
      if (matchingScan) {
        status = 'completed';
      } else if (isBefore(scheduledDate, now) && isAfter(addMinutes(scheduledDate, 5), now)) {
        status = 'running';
      } else if (isBefore(scheduledDate, now)) {
        status = 'missed';
      } else {
        status = 'upcoming';
      }

      return {
        ...scan,
        status,
        actualResult: matchingScan
          ? {
              listings_found: matchingScan.listings_found,
              opportunities_found: matchingScan.opportunities_found,
              status: matchingScan.status,
            }
          : undefined,
      };
    });
  }, [schedule, historyData, today]);

  // Group scans by hour for visual organization
  const scansByHour = useMemo(() => {
    const grouped = new Map<number, ScanWithStatus[]>();
    scansWithStatus.forEach((scan) => {
      const hour = parseInt(scan.scheduledTime.split(':')[0], 10);
      const existing = grouped.get(hour) || [];
      grouped.set(hour, [...existing, scan]);
    });
    return grouped;
  }, [scansWithStatus]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const total = scansWithStatus.length;
    const completed = scansWithStatus.filter((s) => s.status === 'completed').length;
    const broadSweeps = scansWithStatus.filter((s) => s.type === 'broad_sweep').length;
    const watchlist = scansWithStatus.filter((s) => s.type === 'watchlist').length;
    const upcoming = scansWithStatus.filter((s) => s.status === 'upcoming').length;

    return { total, completed, broadSweeps, watchlist, upcoming };
  }, [scansWithStatus]);

  if (scheduleError) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <span>Failed to load schedule</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Today&apos;s Scan Schedule
            </CardTitle>
            <CardDescription>
              {schedule && (
                <span>
                  Operating hours: {schedule.operatingHours.start} - {schedule.operatingHours.end}
                  {' • '}Version {schedule.scheduleVersion}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <Search className="h-4 w-4 text-blue-500" />
              <span>{stats.broadSweeps} broad</span>
            </div>
            <div className="flex items-center gap-1">
              <Target className="h-4 w-4 text-purple-500" />
              <span>{stats.watchlist} watchlist</span>
            </div>
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>
                {stats.completed}/{stats.total}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {scheduleLoading ? (
          <ScheduleViewerSkeleton />
        ) : scansWithStatus.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No scans scheduled for today</div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-4">
              {Array.from(scansByHour.entries())
                .sort(([a], [b]) => a - b)
                .map(([hour, scans]) => (
                  <div key={hour} className="relative">
                    {/* Hour header */}
                    <div className="sticky top-0 bg-background z-10 py-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {hour.toString().padStart(2, '0')}:00
                        <span className="text-xs">({scans.length} scans)</span>
                      </div>
                    </div>

                    {/* Scans in this hour */}
                    <div className="ml-6 border-l-2 border-muted pl-4 space-y-2">
                      {scans.map((scan) => (
                        <div
                          key={scan.id}
                          className={`flex items-center justify-between p-2 rounded-md ${
                            scan.status === 'completed'
                              ? 'bg-green-50'
                              : scan.status === 'running'
                                ? 'bg-blue-50'
                                : scan.status === 'missed'
                                  ? 'bg-red-50'
                                  : 'bg-muted/30'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {getStatusIcon(scan.status)}
                            <span className="text-sm font-mono">
                              {scan.scheduledTime.slice(0, 5)}
                            </span>
                            {getScanTypeIcon(scan.type)}
                            <span className="text-sm">
                              {scan.type === 'broad_sweep' ? (
                                'Broad Sweep (ALL)'
                              ) : (
                                <>
                                  <span className="font-mono">{scan.setNumber}</span>
                                  {scan.setName && (
                                    <span className="text-muted-foreground ml-1">
                                      {scan.setName}
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            {scan.actualResult && (
                              <span className="text-xs text-muted-foreground">
                                {scan.actualResult.listings_found} listings
                                {scan.actualResult.opportunities_found > 0 && (
                                  <span className="text-green-600 ml-1">
                                    ({scan.actualResult.opportunities_found} opp)
                                  </span>
                                )}
                              </span>
                            )}
                            {getStatusBadge(scan.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleViewerSkeleton() {
  return (
    <div className="space-y-4">
      {[8, 9, 10, 11].map((hour) => (
        <div key={hour}>
          <Skeleton className="h-6 w-24 mb-2" />
          <div className="ml-6 pl-4 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
