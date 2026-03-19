/**
 * POST /api/cron/scanner-image-cleanup
 *
 * Weekly cleanup job that deletes scanner images older than the configured
 * retention period (default 90 days) from Supabase Storage.
 *
 * For each expired session:
 *  1. Lists and deletes all files in scanner-images/{session_id}/
 *  2. Nulls out image_path in scanner_pieces for those sessions
 *  3. Optionally deletes the session records (pass ?delete_sessions=true)
 *
 * Recommended schedule: Weekly on Sunday at 3am UTC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { jobExecutionService, noopHandle } from '@/lib/services/job-execution.service';
import type { ExecutionHandle } from '@/lib/services/job-execution.service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

const STORAGE_BUCKET = 'scanner-images';
const DEFAULT_RETENTION_DAYS = 90;
const PAGE_SIZE = 100;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let execution: ExecutionHandle = noopHandle;

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[Cron ScannerImageCleanup] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse optional query params
    const { searchParams } = new URL(request.url);
    const retentionDays = parseInt(searchParams.get('retention_days') ?? String(DEFAULT_RETENTION_DAYS), 10);
    const deleteSessions = searchParams.get('delete_sessions') === 'true';

    execution = await jobExecutionService.start('scanner-image-cleanup', 'cron');

    console.log(
      `[Cron ScannerImageCleanup] Starting cleanup — retention: ${retentionDays} days, delete_sessions: ${deleteSessions}`
    );

    // Use service role client so we can bypass RLS and access Storage
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing required Supabase environment variables');
    }

    const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Cutoff: sessions whose ended_at is older than retentionDays
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffIso = cutoffDate.toISOString();

    // Collect all expired session IDs (paginated)
    const expiredSessionIds: string[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sessions, error: sessionsError } = await (supabase as any)
        .from('scanner_sessions')
        .select('id')
        .lt('ended_at', cutoffIso)
        .not('ended_at', 'is', null)
        .range(from, to);

      if (sessionsError) {
        throw new Error(`Failed to query scanner_sessions: ${sessionsError.message}`);
      }

      for (const session of sessions ?? []) {
        expiredSessionIds.push(session.id as string);
      }

      hasMore = (sessions?.length ?? 0) === PAGE_SIZE;
      page++;
    }

    console.log(`[Cron ScannerImageCleanup] Found ${expiredSessionIds.length} expired sessions`);

    let totalFilesDeleted = 0;
    let totalStorageErrors = 0;
    let totalPiecesUpdated = 0;
    let totalSessionsDeleted = 0;
    const sessionErrors: string[] = [];

    // Process each expired session
    for (const sessionId of expiredSessionIds) {
      try {
        // 1. List all files in scanner-images/{session_id}/
        const { data: files, error: listError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .list(sessionId);

        if (listError) {
          console.error(`[Cron ScannerImageCleanup] Failed to list files for session ${sessionId}:`, listError.message);
          totalStorageErrors++;
          sessionErrors.push(`${sessionId}: list error — ${listError.message}`);
          continue;
        }

        // 2. Delete all files for this session
        if (files && files.length > 0) {
          const filePaths = files.map((f) => `${sessionId}/${f.name}`);

          // Delete in batches of 100 (Supabase Storage limit)
          for (let i = 0; i < filePaths.length; i += 100) {
            const batch = filePaths.slice(i, i + 100);
            const { error: deleteError } = await supabase.storage
              .from(STORAGE_BUCKET)
              .remove(batch);

            if (deleteError) {
              console.error(
                `[Cron ScannerImageCleanup] Failed to delete batch for session ${sessionId}:`,
                deleteError.message
              );
              totalStorageErrors++;
              sessionErrors.push(`${sessionId}: delete error — ${deleteError.message}`);
            } else {
              totalFilesDeleted += batch.length;
            }
          }
        }

        // 3. Null out image_path in scanner_pieces for this session
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count: piecesUpdated, error: piecesError } = await (supabase as any)
          .from('scanner_pieces')
          .update({ image_path: null })
          .eq('session_id', sessionId)
          .not('image_path', 'is', null)
          .select('id', { count: 'exact' });

        if (piecesError) {
          console.error(
            `[Cron ScannerImageCleanup] Failed to null image_path for session ${sessionId}:`,
            piecesError.message
          );
          sessionErrors.push(`${sessionId}: piece update error — ${piecesError.message}`);
        } else {
          totalPiecesUpdated += piecesUpdated ?? 0;
        }

        // 4. Optionally delete the session record
        if (deleteSessions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: sessionDeleteError } = await (supabase as any)
            .from('scanner_sessions')
            .delete()
            .eq('id', sessionId);

          if (sessionDeleteError) {
            console.error(
              `[Cron ScannerImageCleanup] Failed to delete session ${sessionId}:`,
              sessionDeleteError.message
            );
            sessionErrors.push(`${sessionId}: session delete error — ${sessionDeleteError.message}`);
          } else {
            totalSessionsDeleted++;
          }
        }
      } catch (sessionErr) {
        const msg = sessionErr instanceof Error ? sessionErr.message : String(sessionErr);
        console.error(`[Cron ScannerImageCleanup] Unexpected error for session ${sessionId}:`, msg);
        sessionErrors.push(`${sessionId}: unexpected error — ${msg}`);
      }
    }

    const durationMs = Date.now() - startTime;
    const durationStr =
      durationMs > 60000
        ? `${Math.round(durationMs / 60000)} min`
        : `${Math.round(durationMs / 1000)} sec`;

    const success = sessionErrors.length === 0;

    console.log(
      `[Cron ScannerImageCleanup] Complete — sessions: ${expiredSessionIds.length}, files deleted: ${totalFilesDeleted}, pieces nulled: ${totalPiecesUpdated}, sessions deleted: ${totalSessionsDeleted}, errors: ${sessionErrors.length} (${durationStr})`
    );

    await execution.complete(
      {
        expiredSessions: expiredSessionIds.length,
        filesDeleted: totalFilesDeleted,
        piecesUpdated: totalPiecesUpdated,
        sessionsDeleted: totalSessionsDeleted,
        storageErrors: totalStorageErrors,
        sessionErrors: sessionErrors.slice(0, 10), // cap for payload size
      },
      200,
      expiredSessionIds.length,
      sessionErrors.length
    );

    return NextResponse.json({
      success,
      retentionDays,
      cutoffDate: cutoffIso,
      expiredSessions: expiredSessionIds.length,
      filesDeleted: totalFilesDeleted,
      piecesUpdated: totalPiecesUpdated,
      sessionsDeleted: totalSessionsDeleted,
      storageErrors: totalStorageErrors,
      errors: sessionErrors.length,
      errorDetails: sessionErrors.slice(0, 10),
      durationMs,
      durationStr,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('[Cron ScannerImageCleanup] Fatal error:', error);
    await execution.fail(error, 500);

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        durationMs,
      },
      { status: 500 }
    );
  }
}

// Support GET for manual testing (requires same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}
