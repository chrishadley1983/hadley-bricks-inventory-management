/**
 * Local Terapeak Research Refresh
 *
 * Runs the ResearchService locally where Playwright + Chrome are available.
 * Refreshes expired minifig_price_cache entries using Terapeak (with BrickLink fallback).
 *
 * Designed to run as a Windows Scheduled Task (daily).
 *
 * Prerequisites:
 *   - Run `npm run terapeak:login` at least once to create browser profile
 *   - .env.local must have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   cd apps/web
 *   npx tsx scripts/terapeak-research-refresh.ts [--limit 50] [--force-all]
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50;
const forceAll = args.includes('--force-all');

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const startTime = Date.now();

  console.log(`\n=== Terapeak Research Refresh ===`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Mode: ${forceAll ? 'Force refresh ALL items' : `Expired cache entries (limit ${limit})`}`);

  // Record execution in job_execution_history
  const { data: execRow } = await supabase
    .from('job_execution_history')
    .insert({
      job_name: 'minifig-research-refresh',
      trigger: 'cron' as const,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  const executionId = execRow?.id;

  try {
    // Dynamically import ResearchService (it uses path aliases, so we import from source)
    const { ResearchService } = await import('../src/lib/minifig-sync/research.service');

    const service = new ResearchService(supabase, DEFAULT_USER_ID);

    let itemIds: string[] | undefined;

    if (!forceAll) {
      // Find items whose cache has expired
      const { data: expiredCache } = await supabase
        .from('minifig_price_cache')
        .select('bricklink_id')
        .lt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true })
        .limit(limit);

      if (!expiredCache || expiredCache.length === 0) {
        console.log('\nNo expired cache entries found. Nothing to refresh.');

        if (executionId) {
          await supabase
            .from('job_execution_history')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              duration_ms: Date.now() - startTime,
              items_processed: 0,
              result_summary: { message: 'No expired entries' } as Record<string, unknown>,
              http_status: 200,
            })
            .eq('id', executionId);
        }
        return;
      }

      // Map expired bricklink_ids back to sync item IDs
      const bricklinkIds = expiredCache.map((e) => e.bricklink_id).filter(Boolean);
      console.log(`Found ${bricklinkIds.length} expired cache entries to refresh`);

      const { data: items } = await supabase
        .from('minifig_sync_items')
        .select('id')
        .eq('user_id', DEFAULT_USER_ID)
        .in('bricklink_id', bricklinkIds);

      itemIds = items?.map((i) => i.id);

      if (!itemIds || itemIds.length === 0) {
        console.log('No sync items found for expired cache entries.');

        if (executionId) {
          await supabase
            .from('job_execution_history')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              duration_ms: Date.now() - startTime,
              items_processed: 0,
              result_summary: { message: 'No matching sync items' } as Record<string, unknown>,
              http_status: 200,
            })
            .eq('id', executionId);
        }
        return;
      }

      console.log(`Matched ${itemIds.length} sync items for research`);
    }

    // Run research with progress logging
    const result = await service.researchAll(itemIds, {
      onProgress: (event) => {
        if (event.type === 'progress') {
          console.log(`  [${event.current}/${event.total}] ${event.message}`);
        } else if (event.type === 'stage') {
          console.log(`\n>> ${event.message}`);
        }
      },
    });

    const duration = Date.now() - startTime;
    console.log(`\n=== Complete ===`);
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`  Items processed: ${result.itemsProcessed}`);
    console.log(`  Freshly researched: ${result.itemsResearched}`);
    console.log(`  From cache: ${result.itemsCached}`);
    console.log(`  Errors: ${result.itemsErrored}`);

    if (result.errors.length > 0) {
      console.log(`\nErrors:`);
      result.errors.forEach((e) => console.log(`  - ${e.item ?? 'unknown'}: ${e.error}`));
    }

    // Update execution record
    if (executionId) {
      await supabase
        .from('job_execution_history')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          duration_ms: duration,
          items_processed: result.itemsProcessed,
          items_failed: result.itemsErrored,
          result_summary: {
            itemsResearched: result.itemsResearched,
            itemsCached: result.itemsCached,
            itemsErrored: result.itemsErrored,
          } as Record<string, unknown>,
          http_status: 200,
        })
        .eq('id', executionId);
    }
  } catch (error) {
    console.error('\nFATAL:', error instanceof Error ? error.message : error);

    if (executionId) {
      await supabase
        .from('job_execution_history')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          error_message: error instanceof Error ? error.message : String(error),
          error_stack: error instanceof Error ? error.stack : undefined,
          http_status: 500,
        })
        .eq('id', executionId);
    }

    process.exit(1);
  }
}

main().catch(console.error);
