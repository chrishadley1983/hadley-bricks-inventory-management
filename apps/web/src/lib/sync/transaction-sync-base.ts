/**
 * Transaction Sync Base
 *
 * Shared scaffold for the per-platform transaction sync services
 * (BrickLink, Brick Owl, PayPal, Amazon, eBay). Extracts only the pieces
 * that are behaviourally identical across services: supabase client
 * resolution, the existing-row prequery used for created/updated counting,
 * and the batched upsert loop.
 *
 * Deliberately NOT extracted (shapes differ per platform): sync-log
 * lifecycle, connection/sync status, orchestration, cursor logic, API
 * fetching, and row mapping.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@hadley-bricks/database';
import { createClient } from '@/lib/supabase/server';
import { sleep } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

export const TX_SYNC_BATCH_SIZE = 100; // Upsert batch size

// ============================================================================
// Shared Types
// ============================================================================

export type SyncRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type SyncMode = 'FULL' | 'INCREMENTAL' | 'HISTORICAL';

/**
 * Canonical Supabase-compatible Json type, re-exported from the database
 * package so platform sync modules share a single declaration.
 */
export type { Json };

/**
 * The honest common core of every platform transaction row.
 *
 * NOTE: BrickLink/BrickOwl rows name their currency column `base_currency`,
 * so those row types extend `Omit<BaseTransactionRow, 'currency'>`.
 */
export interface BaseTransactionRow {
  user_id: string;
  currency: string;
  raw_response: Json;
}

type TxSyncTable = keyof Database['public']['Tables'] & string;

interface BatchUpsertOptions {
  /**
   * Console message logged after the `[<errorContext>]` tag on upsert error.
   * Default: 'Upsert error:' (BrickLink/BrickOwl wording).
   */
  logMessage?: string;
  /**
   * Builds the thrown Error message from the upsert error.
   * Default: (error) => `Failed to upsert transactions: ${error.message}`.
   */
  errorMessage?: (error: { message: string }) => string;
  /** When defined, passed through to the supabase upsert options. */
  ignoreDuplicates?: boolean;
  /** Delay between batches (rate limiting). Not applied after the final batch. */
  interBatchDelayMs?: number;
}

// ============================================================================
// BaseTransactionSyncService Class
// ============================================================================

export abstract class BaseTransactionSyncService {
  constructor(protected readonly supabaseOverride?: SupabaseClient<Database>) {}

  protected async getSupabase(): Promise<SupabaseClient<Database>> {
    return this.supabaseOverride ?? (await createClient());
  }

  /**
   * Upsert rows to a table in TX_SYNC_BATCH_SIZE batches.
   * On error, logs `[<errorContext>] <logMessage>` with the raw error and
   * throws — message formats are parameterized so each platform keeps its
   * pre-extraction wording exactly.
   */
  protected async batchUpsert(
    table: TxSyncTable,
    rows: object[],
    onConflict: string,
    errorContext: string,
    options?: BatchUpsertOptions
  ): Promise<void> {
    // Dynamic table/column names fight the generated Supabase generics here;
    // the platform services have already shaped rows for their tables, so an
    // untyped client cast is safe and keeps the runtime calls identical.
    const supabase = (await this.getSupabase()) as SupabaseClient;

    for (let i = 0; i < rows.length; i += TX_SYNC_BATCH_SIZE) {
      const batch = rows.slice(i, i + TX_SYNC_BATCH_SIZE);

      const upsertOptions: { onConflict: string; ignoreDuplicates?: boolean } = { onConflict };
      if (options?.ignoreDuplicates !== undefined) {
        upsertOptions.ignoreDuplicates = options.ignoreDuplicates;
      }

      const { error } = await supabase.from(table).upsert(batch, upsertOptions);

      if (error) {
        console.error(`[${errorContext}] ${options?.logMessage ?? 'Upsert error:'}`, error);
        throw new Error(
          options?.errorMessage
            ? options.errorMessage(error)
            : `Failed to upsert transactions: ${error.message}`
        );
      }

      if (options?.interBatchDelayMs && i + TX_SYNC_BATCH_SIZE < rows.length) {
        await sleep(options.interBatchDelayMs);
      }
    }
  }

  /**
   * Fetch the set of IDs that already exist for this user — the prequery
   * used for created/updated counting.
   *
   * Single query with no error check and no chunking of `ids`, exactly
   * matching the previous inline behaviour in every service (a failed query
   * yields an empty set, i.e. everything counts as created).
   */
  protected async fetchExistingIds(
    table: TxSyncTable,
    idColumn: string,
    userId: string,
    ids: string[]
  ): Promise<Set<string>> {
    const supabase = (await this.getSupabase()) as SupabaseClient;

    const { data } = await supabase
      .from(table)
      .select(idColumn)
      .eq('user_id', userId)
      .in(idColumn, ids);

    const existing = (data || []) as unknown as Record<string, string>[];
    return new Set(existing.map((row) => row[idColumn]));
  }
}
