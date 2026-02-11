/**
 * Job Execution History Service
 *
 * Lightweight, fire-and-forget logging for cron job executions.
 * Logging failures never block the actual job.
 *
 * Usage in cron routes:
 * ```ts
 * const execution = await jobExecutionService.start('full-sync', 'cron');
 * try {
 *   // ... existing job logic ...
 *   await execution.complete({ platformSyncs: 5 }, 200, itemsProcessed, itemsFailed);
 * } catch (error) {
 *   await execution.fail(error, 500);
 *   throw error; // re-throw so the route still returns 500
 * }
 * ```
 */

import { createServiceRoleClient } from '@/lib/supabase/server';

type JobTrigger = 'cron' | 'manual' | 'service' | 'chained';

export interface ExecutionHandle {
  /** Mark execution as completed successfully */
  complete(
    resultSummary?: Record<string, unknown>,
    httpStatus?: number,
    itemsProcessed?: number,
    itemsFailed?: number
  ): Promise<void>;

  /** Mark execution as failed */
  fail(error: unknown, httpStatus?: number): Promise<void>;
}

/** No-op handle returned when the initial insert fails or for pre-try defaults */
export const noopHandle: ExecutionHandle = {
  complete: async () => {},
  fail: async () => {},
};

/**
 * Start tracking a job execution.
 * Returns a handle to complete or fail the execution.
 * If the initial insert fails, returns a no-op handle so the job isn't blocked.
 */
async function start(jobName: string, trigger: JobTrigger): Promise<ExecutionHandle> {
  const startedAt = new Date().toISOString();

  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('job_execution_history')
      .insert({
        job_name: jobName,
        trigger,
        status: 'running',
        started_at: startedAt,
      })
      .select('id')
      .single();

    if (error || !data) {
      console.warn(`[JobExecution] Failed to insert start record for ${jobName}:`, error?.message);
      return noopHandle;
    }

    const executionId = data.id;
    const startTime = Date.now();

    return {
      async complete(resultSummary?, httpStatus?, itemsProcessed?, itemsFailed?) {
        try {
          const durationMs = Date.now() - startTime;
          await supabase
            .from('job_execution_history')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              duration_ms: durationMs,
              items_processed: itemsProcessed ?? 0,
              items_failed: itemsFailed ?? 0,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              result_summary: (resultSummary ?? null) as any,
              http_status: httpStatus ?? 200,
            })
            .eq('id', executionId);
        } catch (err) {
          console.warn(`[JobExecution] Failed to record completion for ${jobName}:`, err);
        }
      },

      async fail(error, httpStatus?) {
        try {
          const durationMs = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;

          await supabase
            .from('job_execution_history')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              duration_ms: durationMs,
              error_message: errorMessage,
              error_stack: errorStack ?? null,
              http_status: httpStatus ?? 500,
            })
            .eq('id', executionId);
        } catch (err) {
          console.warn(`[JobExecution] Failed to record failure for ${jobName}:`, err);
        }
      },
    };
  } catch (err) {
    console.warn(`[JobExecution] Failed to start execution tracking for ${jobName}:`, err);
    return noopHandle;
  }
}

export const jobExecutionService = { start };
