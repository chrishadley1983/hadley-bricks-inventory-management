'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, SkipForward, Timer, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { PomodoroProgress } from './PomodoroProgress';
import {
  useCurrentPomodoro,
  usePomodoroStats,
  useStartPomodoro,
  useCompletePhase,
  usePausePomodoro,
  useResumePomodoro,
  useCancelPomodoro,
  formatPomodoroTime,
  POMODORO_MODES,
  type PomodoroMode,
} from '@/hooks/use-pomodoro';

interface PomodoroPanelProps {
  className?: string;
}

export function PomodoroPanel({ className }: PomodoroPanelProps) {
  const [selectedMode, setSelectedMode] = useState<PomodoroMode>('classic');
  const [displayTime, setDisplayTime] = useState(0);
  const [progress, setProgress] = useState(100);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  const { data: currentData, isLoading } = useCurrentPomodoro();
  const { data: stats } = usePomodoroStats();

  const startMutation = useStartPomodoro();
  const completePhase = useCompletePhase();
  const pauseMutation = usePausePomodoro();
  const resumeMutation = useResumePomodoro();
  const cancelMutation = useCancelPomodoro();

  const session = currentData?.session;
  const isActive = session && ['work', 'break'].includes(session.status);
  const isPaused = session?.status === 'paused';
  const isBreak = session?.status === 'break';

  // Calculate total phase duration in seconds
  const getPhaseDuration = useCallback(() => {
    if (!session) return 0;
    return isBreak ? session.breakMinutes * 60 : session.workMinutes * 60;
  }, [session, isBreak]);

  // Update display time based on remaining seconds
  useEffect(() => {
    if (currentData?.remainingSeconds !== undefined) {
      setDisplayTime(currentData.remainingSeconds);

      // Calculate progress percentage
      const totalDuration = getPhaseDuration();
      if (totalDuration > 0) {
        setProgress((currentData.remainingSeconds / totalDuration) * 100);
      }
    }
  }, [currentData?.remainingSeconds, getPhaseDuration]);

  // Countdown timer
  useEffect(() => {
    if (isActive && !isPaused && displayTime > 0) {
      intervalRef.current = setInterval(() => {
        setDisplayTime((prev) => {
          if (prev <= 1) {
            // Time's up - trigger phase completion
            handlePhaseComplete();
            return 0;
          }
          const newTime = prev - 1;
          const totalDuration = getPhaseDuration();
          if (totalDuration > 0) {
            setProgress((newTime / totalDuration) * 100);
          }
          return newTime;
        });
      }, 1000);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  }, [isActive, isPaused, getPhaseDuration]);

  const handlePhaseComplete = async () => {
    try {
      // Play audio notification
      playNotificationSound();
      await completePhase.mutateAsync();

      if (isBreak) {
        toast({ title: 'Session complete! Great work!' });
      } else {
        toast({ title: 'Work phase complete! Time for a break.' });
      }
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to complete phase',
        variant: 'destructive',
      });
    }
  };

  const playNotificationSound = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/sounds/notification.mp3');
    }
    audioRef.current.play().catch(() => {
      // Silently fail if audio can't play (e.g., user interaction required)
    });
  };

  const handleStart = async () => {
    try {
      await startMutation.mutateAsync({ mode: selectedMode });
      toast({ title: `Started ${POMODORO_MODES[selectedMode].label} session` });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to start session',
        variant: 'destructive',
      });
    }
  };

  const handlePause = async () => {
    try {
      await pauseMutation.mutateAsync();
      toast({ title: 'Session paused' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to pause session',
        variant: 'destructive',
      });
    }
  };

  const handleResume = async () => {
    try {
      await resumeMutation.mutateAsync();
      toast({ title: 'Session resumed' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to resume session',
        variant: 'destructive',
      });
    }
  };

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync();
      toast({ title: 'Session cancelled' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to cancel session',
        variant: 'destructive',
      });
    }
  };

  const handleSkipBreak = async () => {
    try {
      await completePhase.mutateAsync();
      toast({ title: 'Break skipped. Session complete!' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to skip break',
        variant: 'destructive',
      });
    }
  };

  const isAnyMutationPending =
    startMutation.isPending ||
    completePhase.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    cancelMutation.isPending;

  const showIdleState = !session || session.status === 'completed' || session.status === 'cancelled';

  return (
    <TooltipProvider>
      <div
        className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 ${className}`}
        data-testid="pomodoro-panel"
      >
        <Timer className="h-4 w-4 text-muted-foreground" />

        {showIdleState ? (
          // Idle state - show mode selector and start button
          <>
            <Select
              value={selectedMode}
              onValueChange={(value: string) => setSelectedMode(value as PomodoroMode)}
              disabled={isLoading || isAnyMutationPending}
            >
              <SelectTrigger className="h-7 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(POMODORO_MODES).map(([key, mode]) => (
                  <SelectItem key={key} value={key}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={handleStart}
                  disabled={isLoading || isAnyMutationPending}
                >
                  <Play className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Start session</TooltipContent>
            </Tooltip>
          </>
        ) : (
          // Active/Paused state - show progress and controls
          <>
            <PomodoroProgress
              progress={progress}
              size={32}
              strokeWidth={3}
              isBreak={isBreak}
            />

            <div className="flex flex-col">
              <span className="font-mono text-sm font-medium tabular-nums">
                {formatPomodoroTime(displayTime)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {isBreak ? 'Break' : isPaused ? 'Paused' : 'Working'}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {isPaused ? (
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
              ) : (
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
              )}

              {isBreak && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={handleSkipBreak}
                      disabled={isAnyMutationPending}
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Skip break</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={handleCancel}
                    disabled={isAnyMutationPending}
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Cancel session</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}

        {/* Divider */}
        <div className="h-4 w-px bg-border" />

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger>
              <span>
                {stats?.sessionsToday ?? 0}/{stats?.dailyTarget ?? 8}
              </span>
            </TooltipTrigger>
            <TooltipContent>Sessions today / Daily target</TooltipContent>
          </Tooltip>

          {(stats?.streakDays ?? 0) > 0 && (
            <Tooltip>
              <TooltipTrigger>
                <span className="flex items-center gap-1">
                  <Flame className="h-3 w-3 text-orange-500" />
                  {stats?.streakDays}
                </span>
              </TooltipTrigger>
              <TooltipContent>Day streak</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
