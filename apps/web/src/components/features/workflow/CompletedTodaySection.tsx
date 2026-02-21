'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTodaysTasks } from '@/hooks/use-workflow';
import type { CompletedTask } from '@/hooks/use-workflow';

interface CompletedTodaySectionProps {
  className?: string;
}

const STORAGE_KEY = 'workflow-completed-collapsed';

function formatTime(seconds: number | null): string {
  if (!seconds) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatCompletedTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function CompletedTodaySection({ className }: CompletedTodaySectionProps) {
  const { data } = useTodaysTasks();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load collapsed state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setIsCollapsed(stored === 'true');
    }
  }, []);

  // Save collapsed state to localStorage
  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem(STORAGE_KEY, String(newState));
  };

  const completedTasks = data?.completedToday ?? [];
  const summary = data?.summary ?? { tasksCompleted: 0, totalTimeSeconds: 0 };

  if (completedTasks.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Completed Today
            <Badge variant="secondary" className="ml-1">
              {summary.tasksCompleted} {summary.tasksCompleted === 1 ? 'task' : 'tasks'}
            </Badge>
            {summary.totalTimeSeconds > 0 && (
              <Badge variant="outline" className="ml-1">
                <Clock className="h-3 w-3 mr-1" />
                {formatTime(summary.totalTimeSeconds)}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapsed}
            aria-label={isCollapsed ? 'Expand completed tasks' : 'Collapse completed tasks'}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          isCollapsed ? 'max-h-0' : 'max-h-[500px]'
        )}
      >
        <CardContent className="pt-0">
          <div className="space-y-2">
            {completedTasks.map((task: CompletedTask) => (
              <div
                key={task.id}
                className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm font-medium">{task.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {task.category}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {task.timeSpentSeconds && task.timeSpentSeconds > 0 && (
                    <span>{formatTime(task.timeSpentSeconds)}</span>
                  )}
                  <span>{formatCompletedTime(task.completedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
