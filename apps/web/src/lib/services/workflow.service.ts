import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  WorkflowTaskDefinition,
  WorkflowTaskInstanceInsert,
  TaskStatus,
} from '@hadley-bricks/database';
import { WorkflowRepository, ResolvedTaskInstance, CompletedTaskSummary } from '../repositories/workflow.repository';

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
export interface TaskWithCount extends ResolvedTaskInstance {
  count?: number;
  resolutionStats?: ResolutionStats;
}

/**
 * Today's tasks response
 */
export interface TodaysTasksResponse {
  tasks: TaskWithCount[];
  completedToday: CompletedTaskSummary[];
  summary: {
    tasksCompleted: number;
    totalTimeSeconds: number;
  };
}

/**
 * Dynamic count result
 */
interface CountResult {
  countSource: string;
  count: number;
}

/**
 * Service for workflow business logic
 */
export class WorkflowService {
  private readonly repository: WorkflowRepository;

  constructor(private readonly supabase: SupabaseClient<Database>) {
    this.repository = new WorkflowRepository(supabase);
  }

  /**
   * Get today's tasks with dynamic counts
   */
  async getTodaysTasks(userId: string): Promise<TodaysTasksResponse> {
    const today = this.getLocalDateString();

    // Ensure user has workflow data seeded
    const hasData = await this.repository.hasUserData(userId);
    if (!hasData) {
      await this.repository.seedUserData(userId);
    }

    // Generate task instances for today if needed
    await this.generateTodaysInstances(userId, today);

    // Get tasks
    const { pending, completed } = await this.repository.getTodaysTasks(userId, today);

    // Get dynamic counts for tasks that have count_source
    const countSources = [...new Set(pending.filter(t => t.countSource).map(t => t.countSource!))];
    const counts = await this.getDynamicCounts(userId, countSources);
    const countMap = new Map(counts.map(c => [c.countSource, c.count]));

    // Fetch resolution stats if there's a resolution.pending task
    let resolutionStats: ResolutionStats | undefined;
    if (countSources.includes('resolution.pending')) {
      resolutionStats = await this.getResolutionStats(userId);
    }

    // Merge counts into tasks
    const tasksWithCounts: TaskWithCount[] = pending.map(task => ({
      ...task,
      count: task.countSource ? countMap.get(task.countSource) : undefined,
      resolutionStats: task.countSource === 'resolution.pending' ? resolutionStats : undefined,
    }));

    // Calculate summary
    const totalTimeSeconds = completed.reduce((sum, t) => sum + (t.timeSpentSeconds ?? 0), 0);

    return {
      tasks: tasksWithCounts,
      completedToday: completed,
      summary: {
        tasksCompleted: completed.length,
        totalTimeSeconds,
      },
    };
  }

  /**
   * Generate task instances for today based on definitions
   */
  private async generateTodaysInstances(userId: string, date: string): Promise<void> {
    const definitions = await this.repository.getActiveTaskDefinitions(userId);
    const today = new Date(date);
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    // Convert to 1=Mon, ..., 7=Sun for database format
    const dbDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;

    const instancesToCreate: WorkflowTaskInstanceInsert[] = [];

    for (const def of definitions) {
      // Check if instance already exists for this definition today
      const exists = await this.repository.instanceExistsForDefinition(userId, def.id, date);
      if (exists) continue;

      // Check if task should run today based on frequency
      if (!this.shouldTaskRunToday(def, today, dbDayOfWeek)) continue;

      // Create instance
      instancesToCreate.push({
        user_id: userId,
        task_definition_id: def.id,
        scheduled_date: date,
        status: 'pending',
        task_type: def.task_type ?? 'system',
        // Inherit values from definition
        name: def.name,
        description: def.description,
        category: def.category,
        icon: def.icon,
        priority: def.priority,
        estimated_minutes: def.estimated_minutes,
        deep_link_url: def.deep_link_url,
      });
    }

    if (instancesToCreate.length > 0) {
      await this.repository.createTaskInstances(instancesToCreate);
    }
  }

  /**
   * Check if a task should run on a specific day
   */
  private shouldTaskRunToday(def: WorkflowTaskDefinition, date: Date, dbDayOfWeek: number): boolean {
    const frequency = def.frequency;

    switch (frequency) {
      case 'daily':
      case 'twice_daily':
        return true;

      case 'twice_weekly':
      case 'weekly':
        // Check if today is in the frequency_days array
        return def.frequency_days?.includes(dbDayOfWeek) ?? false;

      case 'monthly':
        // Run on first working day of month (simplified: day 1)
        return date.getDate() === 1;

      case 'quarterly':
        // Run on first day of quarter (Jan, Apr, Jul, Oct)
        const month = date.getMonth();
        return date.getDate() === 1 && [0, 3, 6, 9].includes(month);

      case 'biannual':
        // Run on first day of Jan and Jul
        return date.getDate() === 1 && [0, 6].includes(date.getMonth());

      case 'adhoc':
        // Ad-hoc tasks are created manually, not auto-generated
        return false;

      default:
        return false;
    }
  }

  /**
   * Get dynamic counts for various sources
   */
  private async getDynamicCounts(userId: string, sources: string[]): Promise<CountResult[]> {
    const results: CountResult[] = [];

    for (const source of sources) {
      try {
        const count = await this.getCountForSource(userId, source);
        results.push({ countSource: source, count });
      } catch (error) {
        console.error(`Failed to get count for ${source}:`, error);
        results.push({ countSource: source, count: 0 });
      }
    }

    return results;
  }

  /**
   * Get count for a specific source
   */
  private async getCountForSource(userId: string, source: string): Promise<number> {
    switch (source) {
      case 'orders.paid': {
        // Count from platform_orders (Amazon, BrickLink, etc.)
        const { count: platformCount } = await this.supabase
          .from('platform_orders')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('internal_status', 'Paid');

        // Count from ebay_orders (separate table)
        // Paid but not fulfilled: order_payment_status = 'PAID' and order_fulfilment_status != 'FULFILLED'
        const { count: ebayCount } = await this.supabase
          .from('ebay_orders')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('order_payment_status', 'PAID')
          .neq('order_fulfilment_status', 'FULFILLED');

        return (platformCount ?? 0) + (ebayCount ?? 0);
      }

      case 'inventory.backlog': {
        const { count } = await this.supabase
          .from('inventory_items')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'BACKLOG');
        return count ?? 0;
      }

      case 'resolution.pending': {
        // Get pending resolution items from inventory_resolution_queue view or table
        // For now, count inventory items needing resolution
        const { count } = await this.supabase
          .from('order_items')
          .select('*', { count: 'exact', head: true })
          .is('inventory_item_id', null);
        return count ?? 0;
      }

      case 'transactions.uncategorised': {
        const { count } = await this.supabase
          .from('monzo_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('category', null);
        return count ?? 0;
      }

      case 'inventory.stale': {
        // Items in stock for more than 90 days
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 90);
        const { count } = await this.supabase
          .from('inventory_items')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('status', ['Listed', 'LISTED', 'In Stock', 'IN STOCK'])
          .lt('listing_date', cutoffDate.toISOString());
        return count ?? 0;
      }

      case 'amazon_sync.pending': {
        const { count } = await this.supabase
          .from('amazon_sync_queue')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending');
        return count ?? 0;
      }

      case 'listings.low_score': {
        // Listings with score below 70
        // Note: listing_analyses table not yet implemented, return 0 for now
        return 0;
      }

      case 'ebay.refresh_eligible': {
        // eBay listings older than 30 days that haven't been refreshed recently
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        const { count } = await this.supabase
          .from('ebay_listing_refreshes')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'eligible');
        return count ?? 0;
      }

      default:
        console.warn(`Unknown count source: ${source}`);
        return 0;
    }
  }

  /**
   * Get resolution stats for inventory resolution task
   */
  private async getResolutionStats(userId: string): Promise<ResolutionStats> {
    const [ebayPending, amazonPending, unlinked2026, totalUnlinked] = await Promise.all([
      // eBay pending review count
      this.supabase
        .from('ebay_inventory_resolution_queue')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending'),

      // Amazon pending review count
      this.supabase
        .from('amazon_inventory_resolution_queue')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending'),

      // Unlinked order items since Jan 2026 (when app became primary data source)
      // Uses combined function that excludes cancelled/refunded orders and no_inventory items
      this.supabase.rpc('count_all_unlinked_order_items_since', {
        p_user_id: userId,
        p_since_date: '2026-01-01',
      }),

      // Total unlinked order items
      this.supabase
        .from('order_items')
        .select('id, platform_orders!inner(user_id)', { count: 'exact', head: true })
        .is('inventory_item_id', null)
        .eq('platform_orders.user_id', userId),
    ]);

    return {
      pendingReview: (ebayPending.count ?? 0) + (amazonPending.count ?? 0),
      unlinkedSince2026: unlinked2026.data ?? 0,
      totalUnlinked: totalUnlinked.count ?? 0,
    };
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    options?: {
      deferredToDate?: string;
    }
  ): Promise<void> {
    const now = new Date().toISOString();

    const update: Record<string, unknown> = {
      status,
      updated_at: now,
    };

    if (status === 'in_progress') {
      update.started_at = now;
    } else if (status === 'completed' || status === 'skipped') {
      update.completed_at = now;

      // Calculate time spent if task was started
      const { data: task } = await this.supabase
        .from('workflow_task_instances')
        .select('started_at')
        .eq('id', taskId)
        .single();

      if (task?.started_at) {
        const startTime = new Date(task.started_at).getTime();
        const endTime = new Date(now).getTime();
        update.time_spent_seconds = Math.round((endTime - startTime) / 1000);
      }
    } else if (status === 'deferred' && options?.deferredToDate) {
      // Get current task to copy to new date
      const { data: task } = await this.supabase
        .from('workflow_task_instances')
        .select('*')
        .eq('id', taskId)
        .single();

      if (task) {
        // Create new instance for deferred date
        await this.repository.createTaskInstance({
          user_id: task.user_id,
          task_definition_id: task.task_definition_id,
          scheduled_date: options.deferredToDate,
          status: 'pending',
          task_type: task.task_type,
          name: task.name,
          description: task.description,
          category: task.category,
          icon: task.icon,
          priority: task.priority,
          estimated_minutes: task.estimated_minutes,
          deep_link_url: task.deep_link_url,
          deferred_from_date: task.scheduled_date,
        });
      }
    }

    await this.repository.updateTaskInstance(taskId, update);
  }

  /**
   * Create an ad-hoc task
   */
  async createAdHocTask(
    userId: string,
    input: {
      name: string;
      description?: string;
      category: string;
      icon?: string;
      priority?: number;
      estimatedMinutes?: number;
      scheduledDate?: string;
    }
  ): Promise<void> {
    const today = input.scheduledDate ?? this.getLocalDateString();

    await this.repository.createTaskInstance({
      user_id: userId,
      name: input.name,
      description: input.description,
      category: input.category,
      icon: input.icon,
      priority: input.priority ?? 3,
      estimated_minutes: input.estimatedMinutes,
      scheduled_date: today,
      status: 'pending',
      task_type: 'off_system',
    });
  }

  /**
   * Create task from preset
   */
  async createFromPreset(userId: string, presetId: string): Promise<void> {
    const { data: preset, error } = await this.supabase
      .from('off_system_task_presets')
      .select('*')
      .eq('id', presetId)
      .single();

    if (error || !preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    await this.createAdHocTask(userId, {
      name: preset.name,
      category: preset.category,
      icon: preset.icon ?? undefined,
      priority: preset.default_priority ?? 3,
      estimatedMinutes: preset.default_duration_minutes ?? undefined,
    });
  }

  /**
   * Get off-system task presets
   */
  async getPresets(userId: string) {
    return this.repository.getOffSystemPresets(userId);
  }

  /**
   * Get current local date string (YYYY-MM-DD)
   */
  private getLocalDateString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }
}
