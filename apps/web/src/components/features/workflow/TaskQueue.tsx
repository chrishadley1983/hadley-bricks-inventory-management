'use client';

import { useState } from 'react';
import { TaskCard } from './TaskCard';
import { TaskDefinitionsDialog } from './TaskDefinitionsDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, CheckCircle2, Settings2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  useTodaysTasks,
  useStartTask,
  useCompleteTask,
  useSkipTask,
  useDeferTask,
} from '@/hooks/use-workflow';
import { useToast } from '@/hooks/use-toast';
import type { WorkflowTask } from '@/hooks/use-workflow';

interface TaskQueueProps {
  className?: string;
}

export function TaskQueue({ className }: TaskQueueProps) {
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const { data, isLoading, error } = useTodaysTasks();
  const startTask = useStartTask();
  const completeTask = useCompleteTask();
  const skipTask = useSkipTask();
  const deferTask = useDeferTask();
  const { toast } = useToast();

  const handleStart = async (taskId: string) => {
    try {
      await startTask.mutateAsync(taskId);
      toast({ title: 'Task started' });
    } catch {
      toast({ title: 'Failed to start task', variant: 'destructive' });
    }
  };

  const handleComplete = async (taskId: string) => {
    try {
      await completeTask.mutateAsync(taskId);
      toast({ title: 'Task completed' });
    } catch {
      toast({ title: 'Failed to complete task', variant: 'destructive' });
    }
  };

  const handleSkip = async (taskId: string) => {
    try {
      await skipTask.mutateAsync(taskId);
      toast({ title: 'Task skipped' });
    } catch {
      toast({ title: 'Failed to skip task', variant: 'destructive' });
    }
  };

  const handleDefer = async (taskId: string, date: Date) => {
    try {
      await deferTask.mutateAsync({
        taskId,
        deferredToDate: date.toISOString().split('T')[0],
      });
      toast({ title: `Task deferred to ${date.toLocaleDateString()}` });
    } catch {
      toast({ title: 'Failed to defer task', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Skeleton className="h-5 w-32" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Task Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error instanceof Error ? error.message : 'Failed to load tasks'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const tasks = data?.tasks ?? [];
  const pendingTasks = tasks.filter((t: WorkflowTask) => t.status === 'pending' || t.status === 'in_progress');

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Task Queue</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-normal text-muted-foreground">
                {pendingTasks.length} pending
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setConfigDialogOpen(true)}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
      <CardContent>
        {pendingTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
            <p className="text-muted-foreground">All tasks complete for today!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingTasks.map((task: WorkflowTask) => (
              <TaskCard
                key={task.id}
                task={task}
                onStart={() => handleStart(task.id)}
                onComplete={() => handleComplete(task.id)}
                onSkip={() => handleSkip(task.id)}
                onDefer={(date) => handleDefer(task.id, date)}
                isLoading={
                  (startTask.isPending && startTask.variables?.taskId === task.id) ||
                  (completeTask.isPending && completeTask.variables?.taskId === task.id) ||
                  (skipTask.isPending && skipTask.variables?.taskId === task.id) ||
                  (deferTask.isPending && deferTask.variables?.taskId === task.id)
                }
              />
            ))}
          </div>
        )}
      </CardContent>
      </Card>

      <TaskDefinitionsDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
      />
    </>
  );
}
