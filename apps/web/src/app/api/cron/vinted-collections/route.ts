/**
 * POST /api/cron/vinted-collections
 *
 * Daily cron endpoint that checks Gmail for parcel collection emails
 * and posts a Discord notification with any new parcels.
 *
 * Pipeline:
 * 1. Search Gmail for Vinted collection-ready notifications (last 7 days)
 * 2. Search Gmail for Royal Mail collection notifications (last 7 days)
 *    - Links Royal Mail emails to Vinted items by searching for the seller name
 * 3. Parse item name, delivery service, and pickup location from each email
 * 4. Dedup against vinted_collections_reported table
 * 5. Post Discord embed for any new items
 *
 * Recommended schedule: Daily at 8am UK time
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { discordService } from '@/lib/notifications';
import { emailService } from '@/lib/email/email.service';
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
  ['Evri', /evri|hermes|one\s*stop/i],
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

interface ParsedRoyalMail {
  senderName: string;
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

function parseRoyalMailCollection(body: string): ParsedRoyalMail {
  // "Your parcel from Claire Harper is ready to collect* from:"
  const senderMatch = /Your parcel from\s+(.+?)\s+is ready to collect/i.exec(body);
  const senderName = senderMatch ? senderMatch[1].trim() : '';

  // Location follows "from:" on the next line, e.g. "York Parade Post Office [TN10 3NP]"
  const locationMatch = /is ready to collect\*?\s*"?\s*from:\s*\n?\s*(.+)/i.exec(body);
  let location = locationMatch ? locationMatch[1].trim() : '';
  // Strip trailing noise like "Bring ID" or button text
  location = location.replace(/\s*Bring\s+ID.*/i, '').trim();

  return { senderName, location };
}

/**
 * Try to find a Vinted item name by searching for the seller name in Vinted emails.
 * Returns the item name if found, or "Parcel from [name]" as fallback.
 */
async function linkRoyalMailToVintedItem(senderName: string): Promise<string> {
  if (!senderName) return 'Unknown parcel';

  const vintedEmails = await searchEmails(
    `from:no-reply@vinted.co.uk "${senderName}" newer_than:14d`,
    1,
  );

  if (vintedEmails.length > 0) {
    let subject = vintedEmails[0].subject;
    if (subject.toLowerCase().startsWith('order update for ')) {
      subject = subject.slice('Order update for '.length);
    }
    return subject;
  }

  return `Parcel from ${senderName}`;
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

      // Also search Royal Mail collection emails
      const royalMailEmails = await searchEmails(
        `from:no-reply@royalmail.com "ready to collect" newer_than:${DAYS}d`,
        100,
      );

      console.log(`[Cron VintedCollections] Found ${royalMailEmails.length} Royal Mail emails`);

      for (const email of royalMailEmails) {
        const body = await getEmailBody(email.id);
        const parsed = parseRoyalMailCollection(body ?? '');
        const itemName = await linkRoyalMailToVintedItem(parsed.senderName);

        items.push({
          email_id: email.id,
          item: itemName,
          service: 'Royal Mail',
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

    // Group by location for notification
    if (newItems.length > 0) {
      const byLocation = new Map<string, typeof newItems>();
      for (const item of newItems) {
        const key = item.location || 'Unknown location';
        if (!byLocation.has(key)) byLocation.set(key, []);
        byLocation.get(key)!.push(item);
      }

      // Discord: grouped by location
      const discordLines: string[] = [];
      for (const [location, locationItems] of byLocation) {
        discordLines.push(`\n\ud83d\udccd **${location}**`);
        for (const i of locationItems) {
          discordLines.push(`\u2022 ${i.item} (${i.service})`);
        }
      }

      await discordService.send('sync-status', {
        title: `\ud83d\udce6 ${newItems.length} Parcel${newItems.length > 1 ? 's' : ''} Ready to Collect`,
        description: discordLines.join('\n').slice(0, 4000),
        color: 0x09b1ba, // Vinted teal
      });

      // Email: HTML grouped by location
      const locationSections = Array.from(byLocation.entries())
        .map(([location, locationItems]) => {
          const rows = locationItems
            .map(
              (i) =>
                `<tr>
                  <td style="padding:6px 10px;border:1px solid #ddd;">${i.item}</td>
                  <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${i.service}</td>
                </tr>`,
            )
            .join('');
          return `
            <h3 style="color:#333;margin:16px 0 8px 0;">\ud83d\udccd ${location}</h3>
            <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%;">
              <thead>
                <tr style="background:#09b1ba;color:#fff;">
                  <th style="padding:8px 10px;text-align:left;">Item</th>
                  <th style="padding:8px 10px;text-align:center;width:100px;">Service</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`;
        })
        .join('');

      const emailHtml = `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
          <h2 style="color:#333;">\ud83d\udce6 ${newItems.length} Parcel${newItems.length > 1 ? 's' : ''} Ready to Collect</h2>
          ${locationSections}
          <p style="color:#999;font-size:11px;margin-top:24px;">Sent by Hadley Bricks cron</p>
        </div>`;

      await emailService.send({
        to: 'chris@hadleybricks.co.uk',
        subject: `\ud83d\udce6 ${newItems.length} parcel${newItems.length > 1 ? 's' : ''} ready to collect`,
        html: emailHtml,
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
