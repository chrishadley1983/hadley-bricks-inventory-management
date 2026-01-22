/**
 * Workflow hooks
 *
 * React Query hooks for workflow data management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskStatus, OffSystemTaskPreset } from '@hadley-bricks/database';

/**
 * Resolution stats for inventory resolution task
 */
export interface ResolutionStats {
  pendingReview: number;
  unlinkedSince2026: number;
  totalUnlinked: number;
}

/**
 * Task with dynamic count
 */
export interface WorkflowTask {
  id: string;
  name: string;
  description: string | null;
  category: string;
  icon: string | null;
  priority: number;
  estimatedMinutes: number | null;
  scheduledDate: string;
  dueTime: string | null;
  status: TaskStatus;
  deepLinkUrl: string | null;
  deepLinkParams: Record<string, string> | null;
  taskType: 'system' | 'off_system';
  countSource: string | null;
  definitionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  timeSpentSeconds: number | null;
  count?: number;
  resolutionStats?: ResolutionStats;
}

/**
 * Completed task summary
 */
export interface CompletedTask {
  id: string;
  name: string;
  category: string;
  completedAt: string;
  timeSpentSeconds: number | null;
}

/**
 * Today's tasks response
 */
interface TodaysTasksResponse {
  tasks: WorkflowTask[];
  completedToday: CompletedTask[];
  summary: {
    tasksCompleted: number;
    totalTimeSeconds: number;
  };
}

/**
 * Off-system presets response
 */
interface PresetsResponse {
  presets: OffSystemTaskPreset[];
}

/**
 * Task definition from database
 */
export interface TaskDefinition {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  category: string;
  icon: string | null;
  frequency: 'daily' | 'twice_daily' | 'twice_weekly' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'adhoc';
  frequency_days: number[] | null;
  ideal_time: 'AM' | 'PM' | 'ANY' | null;
  priority: number;
  estimated_minutes: number | null;
  deep_link_url: string | null;
  deep_link_params: Record<string, string> | null;
  count_source: string | null;
  task_type: 'system' | 'off_system';
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Query keys for workflow
 */
export const workflowKeys = {
  all: ['workflow'] as const,
  tasks: () => [...workflowKeys.all, 'tasks'] as const,
  todaysTasks: () => [...workflowKeys.tasks(), 'today'] as const,
  futureTasks: () => [...workflowKeys.tasks(), 'future'] as const,
  presets: () => [...workflowKeys.all, 'presets'] as const,
  definitions: () => [...workflowKeys.all, 'definitions'] as const,
};

/**
 * Fetch today's tasks
 */
async function fetchTodaysTasks(): Promise<TodaysTasksResponse> {
  const response = await fetch('/api/workflow/tasks/today');
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch tasks' }));
    throw new Error(error.error || 'Failed to fetch tasks');
  }
  return response.json();
}

/**
 * Update task status
 */
async function updateTaskStatus(params: {
  taskId: string;
  status: TaskStatus;
  deferredToDate?: string;
}): Promise<void> {
  const response = await fetch(`/api/workflow/tasks/${params.taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: params.status,
      deferredToDate: params.deferredToDate,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to update task' }));
    throw new Error(error.error || 'Failed to update task');
  }
}

/**
 * Create ad-hoc task
 */
async function createTask(params: {
  name: string;
  description?: string;
  category: string;
  icon?: string;
  priority?: number;
  estimatedMinutes?: number;
  scheduledDate?: string;
}): Promise<void> {
  const response = await fetch('/api/workflow/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create task' }));
    throw new Error(error.error || 'Failed to create task');
  }
}

/**
 * Create task from preset
 */
async function createFromPreset(presetId: string): Promise<void> {
  const response = await fetch('/api/workflow/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create task from preset' }));
    throw new Error(error.error || 'Failed to create task from preset');
  }
}

/**
 * Fetch off-system presets
 */
async function fetchPresets(): Promise<PresetsResponse> {
  const response = await fetch('/api/workflow/presets');
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch presets' }));
    throw new Error(error.error || 'Failed to fetch presets');
  }
  return response.json();
}

/**
 * Hook to fetch today's tasks
 */
export function useTodaysTasks() {
  return useQuery({
    queryKey: workflowKeys.todaysTasks(),
    queryFn: fetchTodaysTasks,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // 1 minute
  });
}

/**
 * Hook to update task status
 */
export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateTaskStatus,
    onMutate: async (params) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: workflowKeys.todaysTasks() });

      // Snapshot the previous value
      const previous = queryClient.getQueryData<TodaysTasksResponse>(workflowKeys.todaysTasks());

      // Optimistically update
      if (previous) {
        const now = new Date().toISOString();
        let updatedTasks = [...previous.tasks];
        let updatedCompleted = [...previous.completedToday];

        const taskIndex = updatedTasks.findIndex((t) => t.id === params.taskId);
        if (taskIndex !== -1) {
          const task = updatedTasks[taskIndex];

          if (params.status === 'completed' || params.status === 'skipped') {
            // Move to completed
            updatedTasks = updatedTasks.filter((t) => t.id !== params.taskId);
            updatedCompleted = [
              {
                id: task.id,
                name: task.name,
                category: task.category,
                completedAt: now,
                timeSpentSeconds: task.startedAt
                  ? Math.round((new Date(now).getTime() - new Date(task.startedAt).getTime()) / 1000)
                  : null,
              },
              ...updatedCompleted,
            ];
          } else if (params.status === 'deferred') {
            // Remove from list
            updatedTasks = updatedTasks.filter((t) => t.id !== params.taskId);
          } else {
            // Update status
            updatedTasks[taskIndex] = { ...task, status: params.status, startedAt: now };
          }

          queryClient.setQueryData<TodaysTasksResponse>(workflowKeys.todaysTasks(), {
            ...previous,
            tasks: updatedTasks,
            completedToday: updatedCompleted,
            summary: {
              tasksCompleted: updatedCompleted.length,
              totalTimeSeconds: updatedCompleted.reduce((sum, t) => sum + (t.timeSpentSeconds ?? 0), 0),
            },
          });
        }
      }

      return { previous };
    },
    onError: (_err, _params, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(workflowKeys.todaysTasks(), context.previous);
      }
    },
    onSettled: () => {
      // Refetch to sync with server
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
    },
  });
}

/**
 * Hook to start a task
 */
export function useStartTask() {
  const updateStatus = useUpdateTaskStatus();

  return {
    ...updateStatus,
    mutate: (taskId: string) => updateStatus.mutate({ taskId, status: 'in_progress' }),
    mutateAsync: (taskId: string) => updateStatus.mutateAsync({ taskId, status: 'in_progress' }),
  };
}

/**
 * Hook to complete a task
 */
export function useCompleteTask() {
  const updateStatus = useUpdateTaskStatus();

  return {
    ...updateStatus,
    mutate: (taskId: string) => updateStatus.mutate({ taskId, status: 'completed' }),
    mutateAsync: (taskId: string) => updateStatus.mutateAsync({ taskId, status: 'completed' }),
  };
}

/**
 * Hook to skip a task
 */
export function useSkipTask() {
  const updateStatus = useUpdateTaskStatus();

  return {
    ...updateStatus,
    mutate: (taskId: string) => updateStatus.mutate({ taskId, status: 'skipped' }),
    mutateAsync: (taskId: string) => updateStatus.mutateAsync({ taskId, status: 'skipped' }),
  };
}

/**
 * Hook to defer a task
 */
export function useDeferTask() {
  const updateStatus = useUpdateTaskStatus();

  return {
    ...updateStatus,
    mutate: (params: { taskId: string; deferredToDate: string }) =>
      updateStatus.mutate({ taskId: params.taskId, status: 'deferred', deferredToDate: params.deferredToDate }),
    mutateAsync: (params: { taskId: string; deferredToDate: string }) =>
      updateStatus.mutateAsync({ taskId: params.taskId, status: 'deferred', deferredToDate: params.deferredToDate }),
  };
}

/**
 * Hook to create an ad-hoc task
 */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.futureTasks() });
    },
  });
}

/**
 * Hook to create task from preset
 */
export function useCreateFromPreset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createFromPreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
    },
  });
}

/**
 * Hook to fetch off-system presets
 */
export function usePresets() {
  return useQuery({
    queryKey: workflowKeys.presets(),
    queryFn: fetchPresets,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ============================================================================
// TASK DEFINITIONS HOOKS
// ============================================================================

/**
 * Fetch task definitions
 */
async function fetchDefinitions(): Promise<{ definitions: TaskDefinition[] }> {
  const response = await fetch('/api/workflow/definitions');
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch definitions' }));
    throw new Error(error.error || 'Failed to fetch definitions');
  }
  return response.json();
}

/**
 * Update task definition
 */
async function updateDefinition(params: {
  id: string;
  data: Partial<Omit<TaskDefinition, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;
}): Promise<{ definition: TaskDefinition }> {
  const response = await fetch(`/api/workflow/definitions/${params.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to update definition' }));
    throw new Error(error.error || 'Failed to update definition');
  }
  return response.json();
}

/**
 * Create task definition
 */
async function createDefinition(
  data: Omit<TaskDefinition, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'is_system' | 'task_type' | 'deep_link_params' | 'sort_order'>
): Promise<{ definition: TaskDefinition }> {
  const response = await fetch('/api/workflow/definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create definition' }));
    throw new Error(error.error || 'Failed to create definition');
  }
  return response.json();
}

/**
 * Delete task definition
 */
async function deleteDefinition(id: string): Promise<void> {
  const response = await fetch(`/api/workflow/definitions/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to delete definition' }));
    throw new Error(error.error || 'Failed to delete definition');
  }
}

/**
 * Hook to fetch task definitions
 */
export function useTaskDefinitions() {
  return useQuery({
    queryKey: workflowKeys.definitions(),
    queryFn: fetchDefinitions,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update a task definition
 */
export function useUpdateDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateDefinition,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
    },
  });
}

/**
 * Hook to create a task definition
 */
export function useCreateDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createDefinition,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
    },
  });
}

/**
 * Hook to delete a task definition
 */
export function useDeleteDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteDefinition,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.definitions() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
    },
  });
}

// ============================================================================
// FUTURE CUSTOM TASKS HOOKS
// ============================================================================

/**
 * Future custom task instance
 */
export interface FutureTask {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priority: number;
  estimatedMinutes: number | null;
  scheduledDate: string;
  status: string;
  createdAt: string;
}

/**
 * Fetch future custom tasks
 */
async function fetchFutureTasks(): Promise<{ tasks: FutureTask[] }> {
  const response = await fetch('/api/workflow/tasks/future');
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch future tasks' }));
    throw new Error(error.error || 'Failed to fetch future tasks');
  }
  return response.json();
}

/**
 * Update a future custom task
 */
async function updateFutureTask(params: {
  id: string;
  data: {
    name?: string;
    description?: string | null;
    category?: string;
    priority?: number;
    estimatedMinutes?: number | null;
    scheduledDate?: string;
  };
}): Promise<void> {
  const response = await fetch(`/api/workflow/tasks/${params.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to update task' }));
    throw new Error(error.error || 'Failed to update task');
  }
}

/**
 * Delete a future custom task
 */
async function deleteFutureTask(id: string): Promise<void> {
  const response = await fetch(`/api/workflow/tasks/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to delete task' }));
    throw new Error(error.error || 'Failed to delete task');
  }
}

/**
 * Hook to fetch future custom tasks
 */
export function useFutureTasks() {
  return useQuery({
    queryKey: workflowKeys.futureTasks(),
    queryFn: fetchFutureTasks,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update a future custom task
 */
export function useUpdateFutureTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateFutureTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.futureTasks() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
    },
  });
}

/**
 * Hook to delete a future custom task
 */
export function useDeleteFutureTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteFutureTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.futureTasks() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.todaysTasks() });
    },
  });
}
