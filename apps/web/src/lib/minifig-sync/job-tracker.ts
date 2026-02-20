import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { MinifigJobType, JobStatus, MinifigSyncJob } from './types';

export class MinifigJobTracker {
  constructor(
    private supabase: SupabaseClient<Database>,
    private userId: string,
  ) {}

  async start(jobType: MinifigJobType): Promise<string> {
    const { data, error } = await this.supabase
      .from('minifig_sync_jobs')
      .insert({
        user_id: this.userId,
        job_type: jobType,
        status: 'RUNNING' as JobStatus,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to start job: ${error.message}`);
    }

    return data.id;
  }

  async complete(
    jobId: string,
    counts: {
      itemsProcessed: number;
      itemsCreated: number;
      itemsUpdated: number;
      itemsErrored: number;
    },
  ): Promise<void> {
    const { error } = await this.supabase
      .from('minifig_sync_jobs')
      .update({
        status: 'COMPLETED' as JobStatus,
        completed_at: new Date().toISOString(),
        items_processed: counts.itemsProcessed,
        items_created: counts.itemsCreated,
        items_updated: counts.itemsUpdated,
        items_errored: counts.itemsErrored,
      })
      .eq('id', jobId)
      .eq('user_id', this.userId);

    if (error) {
      console.error(`Failed to complete job ${jobId}:`, error.message);
    }
  }

  async fail(
    jobId: string,
    errorLog: unknown[],
    counts?: {
      itemsProcessed?: number;
      itemsCreated?: number;
      itemsUpdated?: number;
      itemsErrored?: number;
    },
  ): Promise<void> {
    const { error } = await this.supabase
      .from('minifig_sync_jobs')
      .update({
        status: 'FAILED' as JobStatus,
        completed_at: new Date().toISOString(),
        error_log: errorLog as unknown as Database['public']['Tables']['minifig_sync_jobs']['Update']['error_log'],
        items_processed: counts?.itemsProcessed ?? 0,
        items_created: counts?.itemsCreated ?? 0,
        items_updated: counts?.itemsUpdated ?? 0,
        items_errored: counts?.itemsErrored ?? 0,
      })
      .eq('id', jobId)
      .eq('user_id', this.userId);

    if (error) {
      console.error(`Failed to mark job ${jobId} as failed:`, error.message);
    }
  }

  async updateCursor(jobId: string, cursor: string): Promise<void> {
    const { error } = await this.supabase
      .from('minifig_sync_jobs')
      .update({ last_poll_cursor: cursor })
      .eq('id', jobId)
      .eq('user_id', this.userId);

    if (error) {
      console.error(`Failed to update cursor for job ${jobId}:`, error.message);
    }
  }

  async getLatestCursor(jobType: MinifigJobType): Promise<string | null> {
    const { data } = await this.supabase
      .from('minifig_sync_jobs')
      .select('last_poll_cursor')
      .eq('user_id', this.userId)
      .eq('job_type', jobType)
      .eq('status', 'COMPLETED')
      .not('last_poll_cursor', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    return data?.last_poll_cursor ?? null;
  }

  async getLatestJob(jobType: MinifigJobType): Promise<MinifigSyncJob | null> {
    const { data } = await this.supabase
      .from('minifig_sync_jobs')
      .select('*')
      .eq('user_id', this.userId)
      .eq('job_type', jobType)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return data;
  }
}
