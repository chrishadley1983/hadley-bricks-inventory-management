/**
 * POST /api/cron/vinted-collections
 *
 * Daily cron endpoint that checks Gmail for Vinted "ready to collect" emails
 * and posts a Discord notification with any new parcels.
 *
 * Pipeline:
 * 1. Search Gmail for Vinted collection-ready notifications (last 7 days)
 * 2. Parse item name, delivery service, and pickup location from each email
 * 3. Dedup against vinted_collections_reported table
 * 4. Post Discord embed for any new items
 *
 * Recommended schedule: Daily at 8am UK time
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { discordService } from '@/lib/notifications';
import { jobExecutionService } from '@/lib/services/job-execution.service';
import {
  searchEmails,
  getEmailBody,
  isGmailConfigured,
} from '@/lib/google/gmail-client';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes

// ---------------------------------------------------------------------------
// Parsers (ported from hadley_api/vinted_routes.py)
// ---------------------------------------------------------------------------

const SERVICE_PATTERNS: [string, RegExp][] = [
  ['InPost', /inpost/i],
  ['Evri', /evri|hermes/i],
  ['Royal Mail', /royal\s*mail/i],
  ['Yodel', /yodel/i],
  ['DPD', /\bdpd\b/i],
];

const LOCATION_RE = /waiting for you at ([\s\S]+?)\.\s*Go/;

function detectService(text: string): string {
  for (const [name, pattern] of SERVICE_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return 'Unknown';
}

interface ParsedCollection {
  item: string;
  service: string;
  location: string;
}

function parseCollection(subject: string, body: string): ParsedCollection {
  // Item name from subject — strip "Order update for " prefix
  let item = subject;
  if (item.toLowerCase().startsWith('order update for ')) {
    item = item.slice('Order update for '.length);
  }

  let service = 'Unknown';
  let location = '';

  const match = LOCATION_RE.exec(body);
  if (match) {
    let fullLocation = match[1].trim().replace(/\s+/g, ' ');
    fullLocation = fullLocation.replace(/\.\s*Please pick it up$/i, '').trim();

    const parts = fullLocation.split(' - ', 2);
    if (parts.length === 2) {
      service = detectService(parts[0]);
      location = parts[1].trim();
      if (service === 'Unknown') service = parts[0].trim();
    } else {
      service = detectService(fullLocation);
      location = fullLocation;
    }
  }

  return { item, service, location };
}

// ---------------------------------------------------------------------------
// Hadley API fallback (for local dev without Gmail OAuth creds)
// ---------------------------------------------------------------------------

const HADLEY_API_BASE = 'http://172.19.64.1:8100';

interface HadleyCollection {
  email_id: string;
  item: string;
  date: string;
  service: string;
  location: string;
  is_new: boolean;
}

async function fetchViaHadleyApi(days: number): Promise<HadleyCollection[] | null> {
  try {
    const resp = await fetch(
      `${HADLEY_API_BASE}/vinted/collections?days=${days}&mark_reported=false`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.collections ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Auth
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const execution = await jobExecutionService.start('vinted-collections', 'cron');
    const supabase = createServiceRoleClient();
    const DAYS = 7;

    console.log('[Cron VintedCollections] Starting collection check');

    // Collect parsed results
    const items: Array<{
      email_id: string;
      item: string;
      service: string;
      location: string;
      date: string;
    }> = [];

    if (isGmailConfigured()) {
      // Direct Gmail API path
      const emails = await searchEmails(
        `from:no-reply@vinted.co.uk "waiting for you" newer_than:${DAYS}d`,
        100,
      );

      console.log(`[Cron VintedCollections] Found ${emails.length} emails via Gmail API`);

      for (const email of emails) {
        const body = await getEmailBody(email.id);
        const parsed = parseCollection(email.subject, body ?? '');
        items.push({
          email_id: email.id,
          item: parsed.item,
          service: parsed.service,
          location: parsed.location,
          date: email.date,
        });
      }
    } else {
      // Hadley API fallback
      console.log('[Cron VintedCollections] Gmail not configured, trying Hadley API');
      const collections = await fetchViaHadleyApi(DAYS);
      if (collections) {
        for (const c of collections) {
          items.push({
            email_id: c.email_id,
            item: c.item,
            service: c.service,
            location: c.location,
            date: c.date,
          });
        }
      } else {
        throw new Error('Neither Gmail API nor Hadley API available');
      }
    }

    // Dedup against Supabase
    // Table not yet in generated types — cast to any
    const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const emailIds = items.map((i) => i.email_id);
    const { data: existing } = await db
      .from('vinted_collections_reported')
      .select('email_id')
      .in('email_id', emailIds);

    const reportedSet = new Set(
      ((existing ?? []) as Array<{ email_id: string }>).map((r) => r.email_id),
    );
    const newItems = items.filter((i) => !reportedSet.has(i.email_id));

    console.log(
      `[Cron VintedCollections] ${items.length} total, ${newItems.length} new, ${reportedSet.size} already reported`,
    );

    // Mark new items as reported
    if (newItems.length > 0) {
      await db.from('vinted_collections_reported').upsert(
        newItems.map((i) => ({
          email_id: i.email_id,
          item: i.item,
          service: i.service,
          location: i.location,
        })),
        { onConflict: 'email_id' },
      );
    }

    // Discord notification
    if (newItems.length > 0) {
      const lines = newItems.map(
        (i) => `\u2022 **${i.item}** | ${i.service} | ${i.location}`,
      );

      await discordService.send('sync-status', {
        title: `\ud83d\udce6 ${newItems.length} Vinted Parcel${newItems.length > 1 ? 's' : ''} Ready to Collect`,
        description: lines.join('\n').slice(0, 4000),
        color: 0x09b1ba, // Vinted teal
      });
    }

    const duration = Date.now() - startTime;

    await execution.complete(
      { total: items.length, new: newItems.length },
      200,
      newItems.length,
      0,
    );

    return NextResponse.json({
      success: true,
      total: items.length,
      new: newItems.length,
      alreadyReported: items.length - newItems.length,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron VintedCollections] Error:', error);

    try {
      await discordService.sendAlert({
        title: '\ud83d\udd34 Vinted Collections Check Failed',
        message: `Error: ${errorMsg}\nDuration: ${Math.round(duration / 1000)}s`,
        priority: 'high',
      });
    } catch {
      // Ignore Discord errors
    }

    return NextResponse.json({ error: errorMsg, duration }, { status: 500 });
  }
}

// Support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
