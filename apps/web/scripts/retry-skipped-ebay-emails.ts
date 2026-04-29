// Retry eBay rows in processed_purchase_emails that were marked
// status='skipped' / skip_reason='no_set_number' BEFORE the body-fallback +
// multi-item parser fixes landed. The cron normally won't re-process them
// because email_id already exists; this script deletes the stale rows so the
// next cron pass fetches the email fresh and runs the new parser.
//
// Defaults to dry-run. Pass --commit to actually delete rows.
//
//   npx tsx scripts/retry-skipped-ebay-emails.ts            # report only
//   npx tsx scripts/retry-skipped-ebay-emails.ts --commit   # delete rows
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';
import { getEmailBody } from '../src/lib/google/gmail-client';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const COMMIT = process.argv.includes('--commit');

// Local mirror of the patched single-item set-number extraction.
function extractSetNumber(subject: string, body: string): string | null {
  const m = subject.match(/(?:Order confirmed|You won)[:\s]*(.+)/i);
  if (!m) return null;
  const itemName = m[1].replace(/\.{3}$/, '').trim();
  const subjMatch = itemName.match(/\((\d{4,5})\)|(?:^|\s)(\d{4,5})(?:-\d)?(?:\s|$)/);
  if (subjMatch) return subjMatch[1] || subjMatch[2];
  const norm = body.replace(/[\r\n\s]+/g, ' ');
  const bodyParen = norm.match(/\((\d{4,5})\)/);
  return bodyParen ? bodyParen[1] : null;
}

(async () => {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('processed_purchase_emails')
    .select('id, email_id, email_subject, email_date')
    .eq('source', 'eBay')
    .eq('status', 'skipped')
    .eq('skip_reason', 'no_set_number')
    .gte('created_at', since);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Inspecting ${rows?.length ?? 0} skipped eBay rows (last 60d). commit=${COMMIT}\n`);

  const toDelete: string[] = [];
  for (const row of rows ?? []) {
    const body = await getEmailBody(row.email_id);
    if (!body) {
      console.log(`[skip] ${row.email_date}  no body for ${row.email_id}  subj="${row.email_subject}"`);
      continue;
    }
    const set = extractSetNumber(row.email_subject ?? '', body);
    if (set) {
      console.log(`[recover] ${row.email_date}  set=${set}  id=${row.id}  subj="${row.email_subject}"`);
      toDelete.push(row.id);
    } else {
      console.log(`[keep]    ${row.email_date}  no set found  subj="${row.email_subject}"`);
    }
  }

  console.log(`\n${toDelete.length} row(s) recoverable.`);
  if (!COMMIT) {
    console.log('Dry run — pass --commit to delete these rows. After deletion, trigger the next cron run (or wait for the daily 02:17 UTC) to re-ingest them.');
    return;
  }
  if (toDelete.length === 0) return;
  const { error: delErr } = await supabase
    .from('processed_purchase_emails')
    .delete()
    .in('id', toDelete);
  if (delErr) { console.error('delete failed:', delErr.message); process.exit(1); }
  console.log(`Deleted ${toDelete.length} row(s). Trigger the email-purchases cron to ingest them with the new parser.`);
})();
