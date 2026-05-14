// Backfill: rescue eBay "Order confirmed:" emails that the cron dropped before
// the parser/insert fixes landed. Uses the LOCAL parser (fixed) so it works
// even before the fix is deployed to production. Writes directly to Supabase
// to bypass the deployed batch-import route.
//
// Usage:
//   npx tsx scripts/backfill-missing-ebay-orders.ts            # dry run
//   npx tsx scripts/backfill-missing-ebay-orders.ts --apply    # write
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  searchEmails,
  getEmailBody,
  isGmailConfigured,
} from '../src/lib/google/gmail-client';
import { parseEbayEmail } from '../src/app/api/service/purchases/scan-emails/parsers';

const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

interface Plan {
  action: 'import' | 'skip-no-set' | 'already-tracked' | 'already-purchase';
  email_id: string;
  email_date: string;
  email_subject: string;
  order_reference?: string;
  set_number?: string | null;
  seller_username?: string;
  item_name?: string;
  cost?: number;
}

async function getSystemUserId(): Promise<string> {
  if (process.env.SYSTEM_USER_ID) return process.env.SYSTEM_USER_ID;
  const { data, error } = await supabase.from('profiles').select('id').limit(1).single();
  if (error || !data) throw new Error('No profile found');
  return data.id;
}

async function nextSku(prefix: 'N' | 'U'): Promise<string> {
  const { data } = await supabase
    .from('inventory_items')
    .select('sku')
    .not('sku', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  let max = 0;
  for (const r of data ?? []) {
    const m = (r.sku as string | null)?.match(/^[NU](\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

async function alreadyTracked(emailId: string): Promise<boolean> {
  const { data } = await supabase
    .from('processed_purchase_emails')
    .select('id')
    .eq('email_id', emailId)
    .limit(1);
  return !!(data && data.length > 0);
}

async function alreadyPurchase(reference: string | undefined): Promise<boolean> {
  if (!reference) return false;
  const { data } = await supabase
    .from('purchases')
    .select('id')
    .eq('reference', reference)
    .limit(1);
  return !!(data && data.length > 0);
}

(async () => {
  if (!isGmailConfigured()) {
    console.error('Gmail OAuth not configured — set GOOGLE_GMAIL_* env vars.');
    process.exit(1);
  }
  console.log(`Mode: ${APPLY ? 'APPLY (writes)' : 'dry-run'}\n`);

  const queries = [
    'from:ebay@ebay.co.uk subject:"Order confirmed" newer_than:14d',
    'from:ebay@ebay.com subject:"Order confirmed" newer_than:14d',
  ];
  const byId = new Map<string, Awaited<ReturnType<typeof searchEmails>>[number]>();
  for (const q of queries) {
    const r = await searchEmails(q, 50);
    for (const e of r) byId.set(e.id, e);
  }
  console.log(`Found ${byId.size} eBay "Order confirmed:" emails in last 14d.\n`);

  const plans: Plan[] = [];

  for (const email of byId.values()) {
    if (await alreadyTracked(email.id)) {
      plans.push({
        action: 'already-tracked',
        email_id: email.id,
        email_date: email.date,
        email_subject: email.subject,
      });
      continue;
    }

    const body = await getEmailBody(email.id);
    const candidate = parseEbayEmail({ ...email, body: body ?? email.snippet });
    if (!candidate) continue;

    if (
      candidate.order_reference &&
      (await alreadyPurchase(candidate.order_reference))
    ) {
      // The purchase already exists, but ppe row may be missing (e.g. a previous
      // backfill run created the purchase before its ppe insert errored).
      plans.push({
        action: 'already-purchase',
        email_id: email.id,
        email_date: email.date,
        email_subject: email.subject,
        order_reference: candidate.order_reference,
        set_number: candidate.set_number,
        cost: candidate.cost,
        seller_username: candidate.seller_username,
        item_name: candidate.item_name,
      });
      continue;
    }

    plans.push({
      action: candidate.set_number ? 'import' : 'skip-no-set',
      email_id: email.id,
      email_date: email.date,
      email_subject: email.subject,
      order_reference: candidate.order_reference,
      set_number: candidate.set_number ?? null,
      seller_username: candidate.seller_username,
      item_name: candidate.item_name,
      cost: candidate.cost,
    });
  }

  // Plan summary
  const counts = plans.reduce<Record<string, number>>((acc, p) => {
    acc[p.action] = (acc[p.action] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Plan:', counts, '\n');
  for (const p of plans) {
    console.log(
      `  ${p.action.padEnd(16)} | ${p.email_date.slice(0, 25)} | set=${p.set_number ?? '-'} | ref=${p.order_reference ?? '-'} | £${p.cost ?? '-'} | ${p.email_subject.slice(0, 70)}`
    );
  }

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
    return;
  }

  // Apply: imports and skips for the actionable ones.
  const userId = await getSystemUserId();
  for (const p of plans) {
    if (p.action === 'import' && p.set_number && p.order_reference) {
      // Create purchase
      const { data: purchase, error: purchaseErr } = await supabase
        .from('purchases')
        .insert({
          user_id: userId,
          source: 'eBay',
          cost: p.cost ?? 0,
          payment_method: 'PayPal',
          purchase_date: new Date(p.email_date).toISOString().split('T')[0],
          short_description: `${p.set_number} ${p.item_name ?? ''}`.trim(),
          description: `Backfilled. Seller: ${p.seller_username ?? 'unknown'}`,
          reference: p.order_reference,
        })
        .select('id')
        .single();
      if (purchaseErr || !purchase) {
        console.error(`  ! purchase insert failed for ${p.email_id}:`, purchaseErr);
        continue;
      }

      const sku = await nextSku('N');
      const { data: inventory, error: invErr } = await supabase
        .from('inventory_items')
        .insert({
          user_id: userId,
          set_number: p.set_number,
          item_name: p.item_name ?? `LEGO ${p.set_number}`,
          condition: 'New',
          cost: p.cost ?? 0,
          purchase_id: purchase.id,
          linked_lot: p.order_reference,
          source: 'eBay',
          purchase_date: new Date(p.email_date).toISOString().split('T')[0],
          listing_platform: 'amazon',
          storage_location: 'TBC',
          sku,
          status: 'Not Yet Received',
          notes: `Backfilled. Seller: ${p.seller_username ?? 'unknown'}. https://mail.google.com/mail/u/0/#all/${p.email_id}`,
        })
        .select('id')
        .single();
      if (invErr || !inventory) {
        await supabase.from('purchases').delete().eq('id', purchase.id);
        console.error(`  ! inventory insert failed for ${p.email_id}:`, invErr);
        continue;
      }

      const { error: ppeErr } = await supabase
        .from('processed_purchase_emails')
        .upsert(
          {
            email_id: p.email_id,
            source: 'eBay',
            order_reference: p.order_reference,
            purchase_id: purchase.id,
            inventory_id: inventory.id,
            status: 'imported',
            email_subject: p.email_subject,
            email_date: new Date(p.email_date).toISOString(),
            item_name: p.item_name,
            cost: p.cost,
            seller_username: p.seller_username,
          },
          { onConflict: 'email_id', ignoreDuplicates: true }
        );
      if (ppeErr) console.warn(`  ! ppe insert failed for ${p.email_id}:`, ppeErr);
      console.log(`  imported ${p.set_number} (sku=${sku}, purchase=${purchase.id})`);
    } else if (p.action === 'already-purchase' && p.order_reference) {
      // Backfill the missing ppe row for an already-imported purchase. Look up
      // the purchase + (optionally) inventory item by reference so the ppe row
      // is properly linked.
      const { data: purchaseRow } = await supabase
        .from('purchases')
        .select('id')
        .eq('reference', p.order_reference)
        .limit(1)
        .single();
      const { data: invRow } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('linked_lot', p.order_reference)
        .limit(1)
        .maybeSingle();
      const { error } = await supabase
        .from('processed_purchase_emails')
        .upsert(
          {
            email_id: p.email_id,
            source: 'eBay',
            order_reference: p.order_reference,
            purchase_id: purchaseRow?.id,
            inventory_id: invRow?.id,
            status: 'imported',
            email_subject: p.email_subject,
            email_date: new Date(p.email_date).toISOString(),
            item_name: p.item_name,
            cost: p.cost,
            seller_username: p.seller_username,
          },
          { onConflict: 'email_id', ignoreDuplicates: true }
        );
      if (error) console.warn(`  ! ppe backfill failed for ${p.email_id}:`, error);
      else console.log(`  ppe backfilled for ${p.set_number ?? '?'} (${p.order_reference})`);
    } else if (p.action === 'skip-no-set') {
      const { error } = await supabase
        .from('processed_purchase_emails')
        .upsert(
          {
            email_id: p.email_id,
            source: 'eBay',
            order_reference: p.order_reference,
            status: 'skipped',
            skip_reason: 'no_set_number',
            email_subject: p.email_subject,
            email_date: new Date(p.email_date).toISOString(),
            item_name: p.item_name,
            cost: p.cost,
            seller_username: p.seller_username,
          },
          { onConflict: 'email_id', ignoreDuplicates: true }
        );
      if (error) console.warn(`  ! skip insert failed for ${p.email_id}:`, error);
      console.log(`  skipped ${p.email_subject.slice(0, 50)}`);
    }
  }
})();
