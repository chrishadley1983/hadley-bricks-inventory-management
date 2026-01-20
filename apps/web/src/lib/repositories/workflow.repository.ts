import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  WorkflowTaskDefinition,
  WorkflowTaskInstance,
  WorkflowTaskInstanceInsert,
  WorkflowTaskInstanceUpdate,
  OffSystemTaskPreset,
  TaskStatus,
} from '@hadley-bricks/database';

/**
 * Task instance with resolved definition data
 */
export interface ResolvedTaskInstance {
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
}

/**
 * Completed task summary
 */
export interface CompletedTaskSummary {
  id: string;
  name: string;
  category: string;
  completedAt: string;
  timeSpentSeconds: number | null;
}

/**
 * Repository for workflow operations
 */
export class WorkflowRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Seed workflow data for a user (calls database function)
   */
  async seedUserData(userId: string): Promise<void> {
    const { error } = await this.supabase.rpc('seed_workflow_data', {
      p_user_id: userId,
    });

    if (error) {
      throw new Error(`Failed to seed workflow data: ${error.message}`);
    }
  }

  /**
   * Check if user has workflow data
   */
  async hasUserData(userId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('workflow_task_definitions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to check workflow data: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }

  /**
   * Get active task definitions for a user
   */
  async getActiveTaskDefinitions(userId: string): Promise<WorkflowTaskDefinition[]> {
    const { data, error } = await this.supabase
      .from('workflow_task_definitions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      throw new Error(`Failed to get task definitions: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Get task instances for a specific date
   */
  async getTaskInstancesForDate(userId: string, date: string): Promise<WorkflowTaskInstance[]> {
    const { data, error } = await this.supabase
      .from('workflow_task_instances')
      .select('*')
      .eq('user_id', userId)
      .eq('scheduled_date', date)
      .order('priority', { ascending: true });

    if (error) {
      throw new Error(`Failed to get task instances: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Get today's task instances with definition data resolved
   */
  async getTodaysTasks(userId: string, date: string): Promise<{
    pending: ResolvedTaskInstance[];
    completed: CompletedTaskSummary[];
  }> {
    // Get instances for today
    const { data: instances, error: instanceError } = await this.supabase
      .from('workflow_task_instances')
      .select(`
        *,
        definition:workflow_task_definitions(*)
      `)
      .eq('user_id', userId)
      .eq('scheduled_date', date);

    if (instanceError) {
      throw new Error(`Failed to get today's tasks: ${instanceError.message}`);
    }

    const pending: ResolvedTaskInstance[] = [];
    const completed: CompletedTaskSummary[] = [];

    for (const instance of instances ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const def = (instance as any).definition as WorkflowTaskDefinition | null;

      const resolved: ResolvedTaskInstance = {
        id: instance.id,
        name: instance.name ?? def?.name ?? 'Unknown Task',
        description: instance.description ?? def?.description ?? null,
        category: instance.category ?? def?.category ?? 'Other',
        icon: instance.icon ?? def?.icon ?? null,
        priority: instance.priority ?? def?.priority ?? 3,
        estimatedMinutes: instance.estimated_minutes ?? def?.estimated_minutes ?? null,
        scheduledDate: instance.scheduled_date,
        dueTime: instance.due_time,
        status: (instance.status as TaskStatus) ?? 'pending',
        deepLinkUrl: instance.deep_link_url ?? def?.deep_link_url ?? null,
        deepLinkParams: def?.deep_link_params as Record<string, string> | null,
        taskType: (instance.task_type as 'system' | 'off_system') ?? 'system',
        countSource: def?.count_source ?? null,
        definitionId: instance.task_definition_id,
        startedAt: instance.started_at,
        completedAt: instance.completed_at,
        timeSpentSeconds: instance.time_spent_seconds,
      };

      if (instance.status === 'completed' || instance.status === 'skipped') {
        completed.push({
          id: instance.id,
          name: resolved.name,
          category: resolved.category,
          completedAt: instance.completed_at ?? instance.updated_at ?? '',
          timeSpentSeconds: instance.time_spent_seconds,
        });
      } else {
        pending.push(resolved);
      }
    }

    // Sort pending by priority (ascending - 1 first), then by sort_order
    pending.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return 0;
    });

    // Sort completed by completion time (most recent first)
    completed.sort((a, b) => {
      return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
    });

    return { pending, completed };
  }

  /**
   * Create a task instance
   */
  async createTaskInstance(input: WorkflowTaskInstanceInsert): Promise<WorkflowTaskInstance> {
    const { data, error } = await this.supabase
      .from('workflow_task_instances')
      .insert(input)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create task instance: ${error.message}`);
    }

    return data;
  }

  /**
   * Create multiple task instances
   */
  async createTaskInstances(inputs: WorkflowTaskInstanceInsert[]): Promise<WorkflowTaskInstance[]> {
    if (inputs.length === 0) return [];

    const { data, error } = await this.supabase
      .from('workflow_task_instances')
      .insert(inputs)
      .select();

    if (error) {
      throw new Error(`Failed to create task instances: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Update a task instance
   */
  async updateTaskInstance(id: string, input: WorkflowTaskInstanceUpdate): Promise<WorkflowTaskInstance> {
    const { data, error } = await this.supabase
      .from('workflow_task_instances')
      .update(input)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update task instance: ${error.message}`);
    }

    return data;
  }

  /**
   * Get off-system task presets
   */
  async getOffSystemPresets(userId: string): Promise<OffSystemTaskPreset[]> {
    const { data, error } = await this.supabase
      .from('off_system_task_presets')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      throw new Error(`Failed to get off-system presets: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Check if instances exist for a definition on a specific date
   */
  async instanceExistsForDefinition(
    userId: string,
    definitionId: string,
    date: string
  ): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('workflow_task_instances')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('task_definition_id', definitionId)
      .eq('scheduled_date', date);

    if (error) {
      throw new Error(`Failed to check instance existence: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }

  /**
   * Get deferred tasks from previous dates that haven't been rescheduled
   */
  async getDeferredTasks(userId: string, beforeDate: string): Promise<WorkflowTaskInstance[]> {
    const { data, error } = await this.supabase
      .from('workflow_task_instances')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'deferred')
      .lt('scheduled_date', beforeDate);

    if (error) {
      throw new Error(`Failed to get deferred tasks: ${error.message}`);
    }

    return data ?? [];
  }
}
