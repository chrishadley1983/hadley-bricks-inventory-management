/**
 * Service API: Scan Purchase Emails
 *
 * GET - Scan Gmail for Vinted and eBay purchase confirmation emails
 * Uses processed_purchase_emails table for robust deduplication
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withServiceAuth } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  searchEmails as gmailSearchEmails,
  getEmailBody as gmailGetEmailBody,
  isGmailConfigured,
} from '@/lib/google/gmail-client';
import {
  type PurchaseCandidate,
  extractAllSetNumbers,
  parseEbayEmail,
} from './parsers';

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional().default(7),
  includeProcessed: z.coerce.boolean().optional().default(false),
});

// Hadley API base URL (fallback for local dev without Gmail OAuth creds)
const HADLEY_API_BASE = 'http://172.19.64.1:8100';

/**
 * Fetch full email details including body.
 * Tries direct Gmail API first, falls back to Hadley API.
 */
async function fetchEmailBody(emailId: string): Promise<string | null> {
  // Try direct Gmail API first
  const directBody = await gmailGetEmailBody(emailId);
  if (directBody !== null) return directBody;

  // Fall back to Hadley API
  try {
    const response = await fetch(`${HADLEY_API_BASE}/gmail/get?id=${encodeURIComponent(emailId)}`);

    if (!response.ok) {
      console.error(`[scan-emails] Gmail get failed for ${emailId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.body || null;
  } catch (error) {
    console.error(`[scan-emails] Failed to fetch email ${emailId}:`, error);
    return null;
  }
}

/**
 * Fetch emails matching a Gmail query.
 * Tries direct Gmail API first, falls back to Hadley API.
 */
async function fetchEmails(query: string): Promise<
  Array<{
    id: string;
    threadId: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
    body?: string;
  }>
> {
  // Try direct Gmail API first
  if (isGmailConfigured()) {
    try {
      const results = await gmailSearchEmails(query, 50);
      if (results.length > 0 || isGmailConfigured()) {
        // Enrich with bodies
        const enriched = await Promise.all(
          results.map(async (email) => {
            const body = await gmailGetEmailBody(email.id);
            return { ...email, body: body || email.snippet };
          })
        );
        console.log(`[scan-emails] Fetched ${enriched.length} emails via Gmail API`);
        return enriched;
      }
    } catch (err) {
      console.warn('[scan-emails] Gmail API failed, falling back to Hadley API:', err);
    }
  }

  // Fall back to Hadley API
  try {
    const response = await fetch(
      `${HADLEY_API_BASE}/gmail/search?q=${encodeURIComponent(query)}&limit=50`
    );

    if (!response.ok) {
      console.error(`[scan-emails] Gmail search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    let emails: Array<{
      id: string;
      threadId: string;
      subject: string;
      from: string;
      date: string;
      snippet: string;
      body?: string;
    }> = [];

    if (Array.isArray(data.emails)) emails = data.emails;
    else if (Array.isArray(data.messages)) emails = data.messages;
    else if (Array.isArray(data)) emails = data;

    // Fetch full body for each email (needed for price extraction)
    const enrichedEmails = await Promise.all(
      emails.map(async (email) => {
        const body = await fetchEmailBody(email.id);
        return { ...email, body: body || email.snippet };
      })
    );

    console.log(`[scan-emails] Fetched ${enrichedEmails.length} emails via Hadley API`);
    return enrichedEmails;
  } catch (error) {
    console.error('[scan-emails] Failed to fetch emails:', error);
    return [];
  }
}

/**
 * Extract individual item names from the Vinted email body Order section.
 * Body format has items between "| Order |" and "| Paid |", separated by newlines.
 */
function extractBundleItems(body: string): string[] {
  // Match content between Order and Paid sections
  const orderMatch = body.match(/\|\s*Order\s*\|([\s\S]*?)\|\s*Paid/i);
  if (!orderMatch) return [];

  // Split by newlines and filter empty lines
  return orderMatch[1]
    .split('\n')
    .map((line) => line.replace(/^\|?\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('|'));
}

/**
 * Normalize a forwarded Vinted receipt email (e.g. from Proton Mail).
 * Strips forwarding artifacts so the result can be parsed by parseVintedEmail.
 *
 * Proton forwarding format:
 *   Subject: "Fw: Your receipt for \"Item Name\""
 *   Body: Proton header + "------- Forwarded Message -------" + original email quoted with "> "
 */
function normalizeForwardedEmail(email: {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
}): {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
} {
  // Strip "Fw: " or "Fwd: " prefix from subject
  let subject = email.subject.replace(/^Fw(?:d)?:\s*/i, '');

  // Normalize straight quotes to Unicode quotes that parseVintedEmail expects
  // Proton uses "Item Name" but Vinted originals use „Item Name"
  subject = subject.replace(
    /Your receipt for\s*"(.+?)"/i,
    (_, name) => `Your receipt for \u201E${name}\u201C`
  );

  let body = email.body || '';

  // Extract the forwarded message body (after the Proton header block)
  const fwdMarker = body.indexOf('------- Forwarded Message -------');
  if (fwdMarker !== -1) {
    // Skip past the forwarding headers (From:, Date:, Subject:, To: lines)
    const afterMarker = body.substring(fwdMarker);
    // Find the first empty line after the headers, which starts the original body
    const headerEnd = afterMarker.match(/\nTo:[^\n]*\n\s*\n/);
    if (headerEnd) {
      body = afterMarker.substring(headerEnd.index! + headerEnd[0].length);
    } else {
      // Fallback: skip past the marker line itself
      const markerEnd = afterMarker.indexOf('\n');
      body = markerEnd !== -1 ? afterMarker.substring(markerEnd + 1) : afterMarker;
    }
  }

  // Strip "> " quote prefixes from each line
  body = body
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n');

  // Extract original email date from the forwarding headers if available
  // Format: "Date: On Tuesday, 24 February 2026 at 09:25"
  let emailDate = email.date;
  const origDateMatch = (email.body || '').match(
    /Date:\s*On\s+\w+,\s+(\d{1,2}\s+\w+\s+\d{4})\s+at\s+([\d:]+)/i
  );
  if (origDateMatch) {
    const parsed = new Date(`${origDateMatch[1]} ${origDateMatch[2]} UTC`);
    if (!isNaN(parsed.getTime())) {
      emailDate = parsed.toISOString();
    }
  }

  return {
    id: email.id,
    subject,
    from: email.from,
    date: emailDate,
    snippet: email.snippet,
    body,
  };
}

/**
 * Parse Vinted purchase confirmation email.
 * Returns an array of candidates - multiple for bundles, single for regular purchases.
 * Subject format: Your receipt for „{item name}"
 */
function parseVintedEmail(email: {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
}): Partial<PurchaseCandidate>[] {
  // Subject pattern: "Your receipt for „Item Name""
  // Handle double-quote variants (NOT single quotes - those match apostrophes in names like "Gabby's")
  // Vinted uses U+201E (opening „) and U+201C (closing ")
  const DQUOTES = '\u201C\u201D\u201E\u201F\u00AB\u00BB"';
  const subjectMatch = email.subject.match(
    new RegExp(`Your receipt for\\s*[${DQUOTES}](.+?)[${DQUOTES}]`, 'i')
  );
  let subjectItemName: string;

  if (!subjectMatch) {
    // Fallback: try without quotes entirely - just grab everything after "Your receipt for"
    const fallbackMatch = email.subject.match(/Your receipt for\s+(.+)/i);
    if (!fallbackMatch) return [];
    subjectItemName = fallbackMatch[1].trim();
  } else {
    subjectItemName = subjectMatch[1];
  }

  // Strip any residual quote characters from item name
  subjectItemName = subjectItemName
    .replace(
      /^[\u201C\u201D\u201E\u201F\u00AB\u00BB"]+|[\u201C\u201D\u201E\u201F\u00AB\u00BB"]+$/g,
      ''
    )
    .trim();

  const content = email.body || email.snippet;
  const normalizedContent = content.replace(/[\r\n\s]+/g, ' ');

  // Extract common fields from email body
  const paidMatch = normalizedContent.match(/Paid\s*\|?\s*£([\d.]+)/i);
  const totalCost = paidMatch ? parseFloat(paidMatch[1]) : 0;

  const sellerMatch = normalizedContent.match(/Seller\s*\|?\s*(\w+)/i);
  const seller = sellerMatch ? sellerMatch[1] : 'unknown';

  const transactionMatch = normalizedContent.match(/Transaction ID\s*\|?\s*(\d+)/i);
  const orderRef = transactionMatch ? transactionMatch[1] : `vinted-${email.id}`;

  const purchaseDate = new Date(email.date).toISOString().split('T')[0];

  // Check if this is a bundle
  const isBundle = /^Bundle \d+ items?$/i.test(subjectItemName);

  if (isBundle) {
    // Extract individual items from the email body
    const bundleItems = extractBundleItems(content);

    if (bundleItems.length === 0) {
      // Couldn't extract items from body - return single candidate for review
      return [
        {
          source: 'Vinted',
          order_reference: orderRef,
          seller_username: seller,
          item_name: subjectItemName,
          set_number: null,
          cost: totalCost,
          purchase_date: purchaseDate,
          email_id: email.id,
          email_subject: email.subject,
          email_date: email.date,
          payment_method: 'Monzo Card',
          suggested_condition: 'New',
          skip_reason: 'no_set_number',
        },
      ];
    }

    // Extract set numbers from all items, expanding multi-set listings
    // e.g. "3 x Lego (30666,30565,30679)" → 3 separate entries
    const expandedItems: Array<{ name: string; setNumber: string | null }> = [];
    for (const name of bundleItems) {
      const setNumbers = extractAllSetNumbers(name);
      if (setNumbers.length > 1) {
        for (const sn of setNumbers) {
          expandedItems.push({ name, setNumber: sn });
        }
      } else if (setNumbers.length === 1) {
        expandedItems.push({ name, setNumber: setNumbers[0] });
      } else {
        expandedItems.push({ name, setNumber: null });
      }
    }

    const allIdentified = expandedItems.every((i) => i.setNumber !== null);

    if (!allIdentified) {
      // If ANY item lacks a set number, return the whole bundle as 1 review candidate
      return [
        {
          source: 'Vinted',
          order_reference: orderRef,
          seller_username: seller,
          item_name: bundleItems.join(' / '),
          set_number: null,
          cost: totalCost,
          purchase_date: purchaseDate,
          email_id: email.id,
          email_subject: email.subject,
          email_date: email.date,
          payment_method: 'Monzo Card',
          suggested_condition: 'New',
          skip_reason: 'no_set_number',
        },
      ];
    }

    // All items identified - return N candidates with bundle grouping
    // Cost split equally across ALL expanded items (not just Vinted line items)
    const perItemCost = Math.round((totalCost / expandedItems.length) * 100) / 100;

    return expandedItems.map((item, index) => ({
      source: 'Vinted' as const,
      order_reference: orderRef,
      seller_username: seller,
      item_name: item.name,
      set_number: item.setNumber,
      cost: perItemCost,
      purchase_date: purchaseDate,
      email_id: email.id,
      email_subject: email.subject,
      email_date: email.date,
      payment_method: 'Monzo Card',
      suggested_condition: 'New' as const,
      bundle_group: orderRef,
      bundle_total_cost: totalCost,
      bundle_index: index + 1,
    }));
  }

  // Non-bundle: single Vinted listing
  // Check if the listing contains multiple set numbers (e.g. "3 x LEGO (30666,30565,30679)")
  let allSetNumbers = extractAllSetNumbers(subjectItemName);

  // If not found in subject, try from the body Order section
  if (allSetNumbers.length === 0) {
    const bodyItems = extractBundleItems(content);
    if (bodyItems.length > 0) {
      allSetNumbers = extractAllSetNumbers(bodyItems[0]);
    }
  }

  if (allSetNumbers.length > 1) {
    // Single listing with multiple sets - expand into bundle-like entries
    const perItemCost = Math.round((totalCost / allSetNumbers.length) * 100) / 100;
    return allSetNumbers.map((sn, index) => ({
      source: 'Vinted' as const,
      order_reference: orderRef,
      seller_username: seller,
      item_name: subjectItemName,
      set_number: sn,
      cost: perItemCost,
      purchase_date: purchaseDate,
      email_id: email.id,
      email_subject: email.subject,
      email_date: email.date,
      payment_method: 'Monzo Card',
      suggested_condition: 'New' as const,
      bundle_group: orderRef,
      bundle_total_cost: totalCost,
      bundle_index: index + 1,
    }));
  }

  const setNumber = allSetNumbers[0] ?? null;

  return [
    {
      source: 'Vinted',
      order_reference: orderRef,
      seller_username: seller,
      item_name: subjectItemName,
      set_number: setNumber,
      cost: totalCost,
      purchase_date: purchaseDate,
      email_id: email.id,
      email_subject: email.subject,
      email_date: email.date,
      payment_method: 'Monzo Card',
      suggested_condition: 'New',
      skip_reason: setNumber ? undefined : 'no_set_number',
    },
  ];
}


/**
 * Parse an eBay multi-item ("Your order is confirmed") email. eBay uses this
 * subject when one cart contains multiple won items — the subject has no item
 * name, so the data lives entirely in the body. Each item block is delimited by
 * "eBay Money Back Guarantee" and contains: title, Price:, Item ID:, Order
 * number:, Seller:. Returns one candidate per *set* (a single item title may
 * itself be an inline bundle like "40462, 40523 And 40764").
 */
function parseEbayMultiItemEmail(email: {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
}): Partial<PurchaseCandidate>[] {
  const raw = email.body || email.snippet;
  if (!raw) return [];

  const norm = raw
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[\r\n]+/g, '\n');

  const detailsMatch = norm.match(/Your order details([\s\S]*?)View order details/i);
  const detailsBlock = detailsMatch ? detailsMatch[1] : norm;

  const itemBlocks = detailsBlock
    .split(/eBay Money Back Guarantee/i)
    .map((b) => b.trim())
    .filter((b) => /Price:/i.test(b) && /Item ID:/i.test(b));

  if (itemBlocks.length === 0) return [];

  // Order-level total: "Total charged to | £XX.XX". Falls back to subtotal sum.
  const totalMatch = norm.match(/Total charged to[^£]*£([\d.]+)/i);
  const orderTotal = totalMatch ? parseFloat(totalMatch[1]) : 0;

  interface ParsedItem {
    title: string;
    price: number;
    seller: string;
    orderRef: string | null;
    setNumbers: string[];
  }
  const items: ParsedItem[] = [];
  for (const block of itemBlocks) {
    const beforePrice = block.split(/Price:/i)[0];
    const titleLines = beforePrice
      .split('\n')
      .map((l) => l.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').trim())
      .filter((l) => l.length > 1 && l !== '|');
    const title = titleLines[titleLines.length - 1] ?? '';

    const priceMatch = block.match(/Price:\s*\|?\s*£([\d.]+)/i);
    if (!priceMatch) continue;
    const orderMatch = block.match(/Order number:\s*\|?\s*([\d-]+)/i);
    const sellerMatch = block.match(/Seller:\s*\|?\s*(\S+)/i);

    items.push({
      title,
      price: parseFloat(priceMatch[1]),
      seller: sellerMatch?.[1] ?? 'unknown',
      orderRef: orderMatch?.[1] ?? null,
      setNumbers: extractAllSetNumbers(title),
    });
  }

  if (items.length === 0) return [];

  const orderRef = items.find((i) => i.orderRef)?.orderRef ?? `ebay-${email.id}`;
  const purchaseDate = new Date(email.date).toISOString().split('T')[0];

  // Fan out: one candidate per set (or one skip-candidate if the title yielded none).
  const candidates: Partial<PurchaseCandidate>[] = [];
  let bundleIndex = 0;
  for (const item of items) {
    const isUsed = /\bused\b|opened|built|incomplete|no box|played/i.test(item.title);
    if (item.setNumbers.length === 0) {
      bundleIndex++;
      candidates.push({
        source: 'eBay',
        order_reference: bundleIndex === 1 ? orderRef : `${orderRef}-${bundleIndex}`,
        seller_username: item.seller,
        item_name: item.title,
        set_number: null,
        cost: item.price,
        purchase_date: purchaseDate,
        email_id: email.id,
        email_subject: email.subject,
        email_date: email.date,
        payment_method: 'PayPal',
        suggested_condition: isUsed ? 'Used' : 'New',
        skip_reason: 'no_set_number',
        bundle_group: orderRef,
        bundle_total_cost: orderTotal || items.reduce((s, i) => s + i.price, 0),
        bundle_index: bundleIndex,
      });
      continue;
    }
    const perSetCost = item.price / item.setNumbers.length;
    for (const setNumber of item.setNumbers) {
      bundleIndex++;
      candidates.push({
        source: 'eBay',
        order_reference: bundleIndex === 1 ? orderRef : `${orderRef}-${bundleIndex}`,
        seller_username: item.seller,
        item_name: item.title,
        set_number: setNumber,
        cost: perSetCost,
        purchase_date: purchaseDate,
        email_id: email.id,
        email_subject: email.subject,
        email_date: email.date,
        payment_method: 'PayPal',
        suggested_condition: isUsed ? 'Used' : 'New',
        bundle_group: orderRef,
        bundle_total_cost: orderTotal || items.reduce((s, i) => s + i.price, 0),
        bundle_index: bundleIndex,
      });
    }
  }
  return candidates;
}

/**
 * GET /api/service/purchases/scan-emails
 * Scan Gmail for Vinted and eBay purchase confirmation emails
 *
 * Query params:
 * - days: Number of days to look back (default: 7, max: 30)
 * - since: ISO date string - only process emails AFTER this date (for first-run safety)
 * - includeProcessed: Include already processed emails in response (default: false)
 */
export async function GET(request: NextRequest) {
  return withServiceAuth(request, ['read'], async (_keyInfo) => {
    try {
      const url = new URL(request.url);
      const params = {
        days: url.searchParams.get('days'),
        since: url.searchParams.get('since'),
        includeProcessed: url.searchParams.get('includeProcessed'),
      };

      const parsed = QuerySchema.safeParse(params);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { days, includeProcessed } = parsed.data;

      // HARDCODED CUTOFF: Only process emails from 1st Feb 2026 onwards
      // This prevents importing historical purchases on first run
      const CUTOFF_DATE = new Date('2026-02-01T00:00:00Z');

      const supabase = createServiceRoleClient();

      const allCandidates: PurchaseCandidate[] = [];
      let totalFetched = 0;
      let totalParsed = 0;
      let totalCutoffSkipped = 0;

      // Search Vinted emails - subject is "Your receipt for „Item Name""
      const vintedEmails = await fetchEmails(
        `from:no-reply@vinted.co.uk subject:"Your receipt for" newer_than:${days}d`
      );
      totalFetched += vintedEmails.length;
      console.log(`[scan-emails] Fetched ${vintedEmails.length} Vinted emails from Gmail`);

      for (const email of vintedEmails) {
        // Skip emails before cutoff date
        const emailDate = new Date(email.date);
        if (emailDate < CUTOFF_DATE) {
          totalCutoffSkipped++;
          console.log(
            `[scan-emails] Skipped Vinted email before cutoff: "${email.subject}" (${email.date})`
          );
          continue;
        }

        const candidates = parseVintedEmail(email);
        if (candidates.length === 0) {
          console.warn(
            `[scan-emails] Failed to parse Vinted email: id=${email.id} subject="${email.subject}" date=${email.date}`
          );
          continue;
        }
        totalParsed++;

        for (const candidate of candidates) {
          if (!candidate.email_id) continue;

          // Check 1: Already processed (by email_id - most reliable)
          const { data: processedEmail } = await supabase
            .from('processed_purchase_emails')
            .select('id, status')
            .eq('email_id', candidate.email_id)
            .limit(1)
            .single();

          if (processedEmail) {
            allCandidates.push({
              ...candidate,
              status: 'already_processed',
            } as PurchaseCandidate);
            continue;
          }

          // Check 2: Already imported (by order_reference - fallback)
          if (candidate.order_reference) {
            const { data: existingPurchase } = await supabase
              .from('purchases')
              .select('id')
              .eq('reference', candidate.order_reference)
              .limit(1);

            if (existingPurchase && existingPurchase.length > 0) {
              allCandidates.push({
                ...candidate,
                status: 'already_imported',
              } as PurchaseCandidate);
              continue;
            }
          }

          allCandidates.push({
            ...candidate,
            status: 'new',
          } as PurchaseCandidate);
        }
      }

      // Search forwarded Vinted emails from Proton Mail (ph2026@proton.me)
      const protonEmails = await fetchEmails(
        `from:ph2026@proton.me subject:"receipt for" newer_than:${days}d`
      );
      totalFetched += protonEmails.length;
      console.log(
        `[scan-emails] Fetched ${protonEmails.length} forwarded Vinted emails from Proton`
      );

      for (const rawEmail of protonEmails) {
        const email = normalizeForwardedEmail(rawEmail);

        // Skip emails before cutoff date
        const emailDate = new Date(email.date);
        if (emailDate < CUTOFF_DATE) {
          totalCutoffSkipped++;
          console.log(
            `[scan-emails] Skipped forwarded Vinted email before cutoff: "${email.subject}" (${email.date})`
          );
          continue;
        }

        const candidates = parseVintedEmail(email);
        if (candidates.length === 0) {
          console.warn(
            `[scan-emails] Failed to parse forwarded Vinted email: id=${email.id} subject="${email.subject}" date=${email.date}`
          );
          continue;
        }
        totalParsed++;

        for (const candidate of candidates) {
          if (!candidate.email_id) continue;

          // Check 1: Already processed (by email_id)
          const { data: processedEmail } = await supabase
            .from('processed_purchase_emails')
            .select('id, status')
            .eq('email_id', candidate.email_id)
            .limit(1)
            .single();

          if (processedEmail) {
            allCandidates.push({
              ...candidate,
              status: 'already_processed',
              forwarded_from: 'ph2026@proton.me',
            } as PurchaseCandidate);
            continue;
          }

          // Check 2: Already imported (by order_reference - catches dupes vs direct Vinted emails)
          if (candidate.order_reference) {
            const { data: existingPurchase } = await supabase
              .from('purchases')
              .select('id')
              .eq('reference', candidate.order_reference)
              .limit(1);

            if (existingPurchase && existingPurchase.length > 0) {
              allCandidates.push({
                ...candidate,
                status: 'already_imported',
                forwarded_from: 'ph2026@proton.me',
              } as PurchaseCandidate);
              continue;
            }
          }

          allCandidates.push({
            ...candidate,
            status: 'new',
            forwarded_from: 'ph2026@proton.me',
          } as PurchaseCandidate);
        }
      }

      // Search eBay emails. Two subject patterns matter:
      //   - "Order confirmed: <item>"      single-item win or BIN (post-payment)
      //   - "Your order is confirmed"      multi-item cart (no item name in subject)
      // "You won" emails are intentionally excluded — they arrive pre-payment with
      // thin bodies (no cost, no order ref, no seller) and would create £0 dupes
      // alongside the proper Order-confirmed twin once payment lands.
      const ebayEmailsUk = await fetchEmails(
        `from:ebay@ebay.co.uk subject:"Order confirmed" newer_than:${days}d`
      );
      const ebayEmailsCom = await fetchEmails(
        `from:ebay@ebay.com subject:"Order confirmed" newer_than:${days}d`
      );
      const ebayMultiUk = await fetchEmails(
        `from:ebay@ebay.co.uk subject:"Your order is confirmed" newer_than:${days}d`
      );
      const ebayMultiCom = await fetchEmails(
        `from:ebay@ebay.com subject:"Your order is confirmed" newer_than:${days}d`
      );
      // Deduplicate by email ID in case an email matches multiple queries
      const ebayEmailMap = new Map<string, (typeof ebayEmailsUk)[number]>();
      for (const email of [
        ...ebayEmailsUk,
        ...ebayEmailsCom,
        ...ebayMultiUk,
        ...ebayMultiCom,
      ]) {
        ebayEmailMap.set(email.id, email);
      }
      const ebayEmails = Array.from(ebayEmailMap.values());
      totalFetched += ebayEmails.length;
      console.log(
        `[scan-emails] Fetched ${ebayEmails.length} eBay emails from Gmail (${ebayEmailsUk.length} UK confirmed, ${ebayEmailsCom.length} COM confirmed, ${ebayMultiUk.length} UK multi-item, ${ebayMultiCom.length} COM multi-item, after dedup)`
      );

      for (const email of ebayEmails) {
        // Skip emails before cutoff date
        const emailDate = new Date(email.date);
        if (emailDate < CUTOFF_DATE) {
          totalCutoffSkipped++;
          console.log(
            `[scan-emails] Skipped eBay email before cutoff: "${email.subject}" (${email.date})`
          );
          continue;
        }

        // Multi-item ("Your order is confirmed") emails have no item in the subject;
        // route them to the body-driven multi-item parser, otherwise use the single-item one.
        const isMultiItem = /^Your order is confirmed/i.test(email.subject);
        const candidates: Partial<PurchaseCandidate>[] = isMultiItem
          ? parseEbayMultiItemEmail(email)
          : (() => {
              const c = parseEbayEmail(email);
              return c ? [c] : [];
            })();

        if (candidates.length === 0) {
          console.warn(
            `[scan-emails] Failed to parse eBay email: id=${email.id} subject="${email.subject}" date=${email.date}`
          );
          continue;
        }
        totalParsed++;

        for (const candidate of candidates) {
          if (!candidate.email_id) continue;

          // Check 1: Already processed (by email_id)
          const { data: processedEmail } = await supabase
            .from('processed_purchase_emails')
            .select('id, status')
            .eq('email_id', candidate.email_id)
            .limit(1)
            .single();

          if (processedEmail) {
            allCandidates.push({
              ...candidate,
              status: 'already_processed',
            } as PurchaseCandidate);
            continue;
          }

          // Check 2: Already imported (by order_reference)
          if (candidate.order_reference) {
            const { data: existingPurchase } = await supabase
              .from('purchases')
              .select('id')
              .eq('reference', candidate.order_reference)
              .limit(1);

            if (existingPurchase && existingPurchase.length > 0) {
              allCandidates.push({
                ...candidate,
                status: 'already_imported',
              } as PurchaseCandidate);
              continue;
            }
          }

          allCandidates.push({
            ...candidate,
            status: 'new',
          } as PurchaseCandidate);
        }
      }

      // Categorize candidates
      const newCandidates = allCandidates.filter((c) => c.status === 'new');
      const readyToImport = newCandidates.filter((c) => !c.skip_reason);
      const needsReview = newCandidates.filter((c) => c.skip_reason);
      const alreadyProcessedCount = allCandidates.filter(
        (c) => c.status === 'already_processed' || c.status === 'already_imported'
      ).length;
      const parseFailures = totalFetched - totalParsed - totalCutoffSkipped;

      console.log(
        `[scan-emails] Summary: ${totalFetched} fetched, ${totalParsed} parsed, ${totalCutoffSkipped} cutoff-skipped, ${parseFailures} parse-failures, ${readyToImport.length} ready, ${needsReview.length} needs-review, ${alreadyProcessedCount} already-processed`
      );

      return NextResponse.json({
        data: {
          candidates: readyToImport,
          needs_review: needsReview,
          already_processed_count: alreadyProcessedCount,
          total_found: allCandidates.length,
          total_fetched: totalFetched,
          total_parsed: totalParsed,
          total_cutoff_skipped: totalCutoffSkipped,
          parse_failures: parseFailures,
          search_period_days: days,
          cutoff_date: CUTOFF_DATE.toISOString().split('T')[0], // Only emails after this date
          // Include full list if requested (for debugging)
          ...(includeProcessed && { all_candidates: allCandidates }),
        },
      });
    } catch (error) {
      console.error('[GET /api/service/purchases/scan-emails] Error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
