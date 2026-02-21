'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  useCurrentTimeEntry,
  useTimeSummary,
  useStartTimeTracking,
  useStopTimeTracking,
  usePauseTimeTracking,
  useResumeTimeTracking,
  formatTimer,
  formatDuration,
  type TimeCategory,
} from '@/hooks/use-time-tracking';

interface TimeTrackingPanelProps {
  className?: string;
}

const CATEGORIES: TimeCategory[] = [
  'Development',
  'Listing',
  'Shipping',
  'Sourcing',
  'Admin',
  'Other',
];

export function TimeTrackingPanel({ className }: TimeTrackingPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<TimeCategory>('Development');
  const [displayTime, setDisplayTime] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const { data: currentEntry, isLoading: isLoadingCurrent } = useCurrentTimeEntry();
  const { data: summary } = useTimeSummary();

  const startMutation = useStartTimeTracking();
  const stopMutation = useStopTimeTracking();
  const pauseMutation = usePauseTimeTracking();
  const resumeMutation = useResumeTimeTracking();

  const isTracking = currentEntry?.entry !== null && currentEntry?.entry !== undefined;
  const isPaused = currentEntry?.entry?.isPaused ?? false;

  // Update display time every second when tracking
  useEffect(() => {
    if (isTracking && !isPaused && currentEntry?.entry) {
      // Set initial display time
      setDisplayTime(currentEntry.entry.elapsedSeconds);

      // Update every second
      intervalRef.current = setInterval(() => {
        setDisplayTime((prev) => prev + 1);
      }, 1000);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else if (isPaused && currentEntry?.entry) {
      // When paused, just show the elapsed time without incrementing
      setDisplayTime(currentEntry.entry.elapsedSeconds);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    } else {
      setDisplayTime(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  }, [isTracking, isPaused, currentEntry?.entry?.elapsedSeconds]);

  const handleStart = async () => {
    try {
      await startMutation.mutateAsync(selectedCategory);
      toast({ title: `Started tracking: ${selectedCategory}` });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to start tracking',
        variant: 'destructive',
      });
    }
  };

  const handleStop = async () => {
    try {
      await stopMutation.mutateAsync();
      toast({ title: 'Time tracking stopped' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to stop tracking',
        variant: 'destructive',
      });
    }
  };

  const handlePause = async () => {
    try {
      await pauseMutation.mutateAsync();
      toast({ title: 'Time tracking paused' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to pause tracking',
        variant: 'destructive',
      });
    }
  };

  const handleResume = async () => {
    try {
      await resumeMutation.mutateAsync();
      toast({ title: 'Time tracking resumed' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to resume tracking',
        variant: 'destructive',
      });
    }
  };

  const isAnyMutationPending =
    startMutation.isPending ||
    stopMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  return (
    <TooltipProvider>
      <div
        className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 ${className}`}
        data-testid="time-tracking-panel"
      >
        {/* Timer Display */}
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium tabular-nums">
            {isTracking ? formatTimer(displayTime) : '--:--'}
          </span>
        </div>

        {/* Category Selector (only when not tracking) */}
        {!isTracking && (
          <Select
            value={selectedCategory}
            onValueChange={(value: string) => setSelectedCategory(value as TimeCategory)}
            disabled={isLoadingCurrent || isAnyMutationPending}
          >
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Current Category (when tracking) */}
        {isTracking && currentEntry?.entry && (
          <span className="text-xs font-medium text-muted-foreground">
            {currentEntry.entry.category}
          </span>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {!isTracking ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={handleStart}
                  disabled={isLoadingCurrent || isAnyMutationPending}
                >
                  <Play className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Start tracking</TooltipContent>
            </Tooltip>
          ) : (
            <>
              {!isPaused ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={handlePause}
                      disabled={isAnyMutationPending}
                    >
                      <Pause className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Pause</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={handleResume}
                      disabled={isAnyMutationPending}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Resume</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={handleStop}
                    disabled={isAnyMutationPending}
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-border" />

        {/* Summary */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger>
              <span>Today: {summary ? formatDuration(summary.today.total) : '--'}</span>
            </TooltipTrigger>
            <TooltipContent>Total time tracked today</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger>
              <span className="hidden sm:inline">
                Week: {summary ? formatDuration(summary.week.total) : '--'}
              </span>
            </TooltipTrigger>
            <TooltipContent>Total time tracked this week</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
