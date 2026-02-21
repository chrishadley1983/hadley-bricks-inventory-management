'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Play,
  Check,
  SkipForward,
  CalendarClock,
  MoreHorizontal,
  ExternalLink,
  Clock,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowTask } from '@/hooks/use-workflow';

interface TaskCardProps {
  task: WorkflowTask;
  onStart: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onDefer: (date: Date) => void;
  isLoading?: boolean;
}

const priorityColors: Record<number, string> = {
  1: 'bg-red-500', // Critical
  2: 'bg-amber-500', // Important
  3: 'bg-blue-500', // Regular
  4: 'bg-gray-400', // Low
};

const priorityLabels: Record<number, string> = {
  1: 'Critical',
  2: 'Important',
  3: 'Regular',
  4: 'Low',
};

export function TaskCard({ task, onStart, onComplete, onSkip, onDefer, isLoading }: TaskCardProps) {
  const [deferCalendarOpen, setDeferCalendarOpen] = useState(false);

  const isInProgress = task.status === 'in_progress';
  const hasCount = task.count !== undefined && task.count > 0;
  const hasDeepLink = !!task.deepLinkUrl;
  const hasResolutionStats = !!task.resolutionStats;

  const handleDeferSelect = (date: Date | undefined) => {
    if (date) {
      onDefer(date);
      setDeferCalendarOpen(false);
    }
  };

  // Build deep link URL with params
  const deepLinkUrl = task.deepLinkUrl
    ? task.deepLinkParams
      ? `${task.deepLinkUrl}?${new URLSearchParams(task.deepLinkParams).toString()}`
      : task.deepLinkUrl
    : null;

  return (
    <Card className={cn('transition-all', isInProgress && 'ring-2 ring-primary')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Priority indicator and task info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Priority dot */}
            <div
              className={cn(
                'w-3 h-3 rounded-full mt-1.5 flex-shrink-0',
                priorityColors[task.priority] || priorityColors[3]
              )}
              title={priorityLabels[task.priority] || 'Regular'}
            />

            {/* Task info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Icon */}
                {task.icon && <span className="text-base">{task.icon}</span>}

                {/* Name with count (hide count when showing resolution stats) */}
                <span className="font-medium text-sm">
                  {task.name}
                  {hasCount && !hasResolutionStats && (
                    <span className="text-muted-foreground ml-1">({task.count})</span>
                  )}
                </span>

                {/* Deep link */}
                {hasDeepLink && deepLinkUrl && (
                  <Link
                    href={deepLinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>

              {/* Resolution stats or description */}
              {hasResolutionStats && task.resolutionStats ? (
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  <p>
                    <span
                      className={
                        task.resolutionStats.pendingReview > 0
                          ? 'text-amber-600 dark:text-amber-400 font-medium'
                          : ''
                      }
                    >
                      {task.resolutionStats.pendingReview} Pending Review
                    </span>
                  </p>
                  <p>
                    <span
                      className={
                        task.resolutionStats.unlinkedSince2026 > 0
                          ? 'text-red-600 dark:text-red-400 font-medium'
                          : ''
                      }
                    >
                      {task.resolutionStats.unlinkedSince2026} Unlinked since Jan 2026
                    </span>
                  </p>
                  <p>{task.resolutionStats.totalUnlinked.toLocaleString()} Total Unlinked</p>
                </div>
              ) : task.description ? (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  {task.description}
                </p>
              ) : null}

              {/* Badges row */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {/* Estimated time */}
                {task.estimatedMinutes && (
                  <Badge variant="secondary" className="text-xs">
                    <Clock className="h-3 w-3 mr-1" />
                    {task.estimatedMinutes}m
                  </Badge>
                )}

                {/* Category */}
                <Badge variant="outline" className="text-xs">
                  {task.category}
                </Badge>

                {/* In progress indicator */}
                {isInProgress && (
                  <Badge variant="default" className="text-xs">
                    In Progress
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                {/* Start button (shown when pending) */}
                {task.status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={onStart} title="Start task">
                    <Play className="h-4 w-4" />
                  </Button>
                )}

                {/* Complete button */}
                <Button variant="ghost" size="sm" onClick={onComplete} title="Mark complete">
                  <Check className="h-4 w-4" />
                </Button>

                {/* More actions dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onSkip}>
                      <SkipForward className="h-4 w-4 mr-2" />
                      Skip
                    </DropdownMenuItem>
                    <Popover open={deferCalendarOpen} onOpenChange={setDeferCalendarOpen}>
                      <PopoverTrigger asChild>
                        <DropdownMenuItem onSelect={(e: Event) => e.preventDefault()}>
                          <CalendarClock className="h-4 w-4 mr-2" />
                          Defer to...
                        </DropdownMenuItem>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                          mode="single"
                          selected={undefined}
                          onSelect={handleDeferSelect}
                          disabled={(date) => date <= new Date()}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
