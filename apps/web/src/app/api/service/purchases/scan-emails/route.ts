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

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional().default(7),
  includeProcessed: z.coerce.boolean().optional().default(false),
});

interface PurchaseCandidate {
  source: 'Vinted' | 'eBay';
  order_reference: string;
  seller_username: string;
  item_name: string;
  set_number: string | null;
  cost: number;
  purchase_date: string;
  email_id: string;
  email_subject: string;
  email_date: string;
  payment_method: string;
  suggested_condition: 'New' | 'Used';
  status: 'new' | 'already_processed' | 'already_imported';
  skip_reason?: string;
  bundle_group?: string; // Shared group ID for bundle items (original order_reference)
  bundle_total_cost?: number; // Total cost of the bundle
  bundle_index?: number; // 1-based index within bundle
}

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
 * Extract ALL LEGO set numbers from text.
 * Handles comma-separated in parentheses like (30666,30565,30679),
 * single in parentheses like (10786), and standalone like 40461.
 */
function extractAllSetNumbers(text: string): string[] {
  // Pattern 1: Comma-separated numbers in parentheses like (30666,30565,30679)
  const multiParenMatch = text.match(/\(([\d,\s-]+)\)/);
  if (multiParenMatch) {
    const nums = multiParenMatch[1]
      .split(/[,\s]+/)
      .map((n) => n.replace(/-\d$/, '').trim())
      .filter((n) => /^\d{4,5}$/.test(n));
    if (nums.length > 1) return nums;
    if (nums.length === 1) return nums;
  }

  // Pattern 2: Single number in parentheses like (10786)
  const singleParenMatch = text.match(/\((\d{4,5})\)/);
  if (singleParenMatch) return [singleParenMatch[1]];

  // Pattern 3: Standalone 4-5 digit numbers (deduplicated)
  const seen = new Set<string>();
  const results: string[] = [];
  for (const match of text.matchAll(/\b(\d{4,5})(?:-\d)?\b/g)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push(match[1]);
    }
  }
  return results;
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
 * Parse eBay purchase confirmation email
 */
function parseEbayEmail(email: {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
}): Partial<PurchaseCandidate> | null {
  // Subject patterns: "Order confirmed: [Item Name]" or "You won: [Item Name]"
  const subjectMatch = email.subject.match(/(?:Order confirmed|You won)[:\s]*(.+)/i);
  if (!subjectMatch) return null;

  const itemName = subjectMatch[1].replace(/\.{3}$/, '').trim(); // Remove trailing ...
  const content = email.body || email.snippet;

  // Normalize content - replace multiple whitespace/newlines with single space for matching
  const normalizedContent = content.replace(/[\r\n\s]+/g, ' ');

  // Extract total price: "Total charged to ... £XX.XX" (what was actually paid)
  // Fallback to item price if total not found
  let cost = 0;
  const totalMatch = normalizedContent.match(/Total charged to[^£]*£([\d.]+)/i);
  if (totalMatch) {
    cost = parseFloat(totalMatch[1]);
  } else {
    // Fallback: "Price: £XX.XX" with possible whitespace
    const priceMatch = normalizedContent.match(/Price:\s*£([\d.]+)/i);
    if (priceMatch) {
      cost = parseFloat(priceMatch[1]);
    }
  }

  // Extract seller: "Seller: username" with possible whitespace
  const sellerMatch = normalizedContent.match(/Seller:\s*(\w+)/i);
  const seller = sellerMatch ? sellerMatch[1].trim() : 'unknown';

  // Extract order reference: "Order number: XX-XXXXX-XXXXX"
  const orderMatch = normalizedContent.match(/Order number:\s*([\d-]+)/i);
  const orderRef = orderMatch ? orderMatch[1] : `ebay-${email.id}`;

  // Try to extract set number from item name - look for 4-5 digit numbers
  // Pattern handles formats like: (40254), 40254, 75192-1
  const setNumberMatch = itemName.match(/\((\d{4,5})\)|(?:^|\s)(\d{4,5})(?:-\d)?(?:\s|$)/);
  const setNumber = setNumberMatch ? setNumberMatch[1] || setNumberMatch[2] : null;

  // Infer condition from item name - default to New, mark Used only if explicit keywords
  const isUsed = /\bused\b|opened|built|incomplete|no box|played/i.test(itemName);

  return {
    source: 'eBay',
    order_reference: orderRef,
    seller_username: seller,
    item_name: itemName,
    set_number: setNumber,
    cost,
    purchase_date: new Date(email.date).toISOString().split('T')[0],
    email_id: email.id,
    email_subject: email.subject,
    email_date: email.date,
    payment_method: 'PayPal',
    suggested_condition: isUsed ? 'Used' : 'New',
    skip_reason: setNumber ? undefined : 'no_set_number',
  };
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

      // Search eBay emails (both .co.uk and .com domains, both "Order confirmed" and "You won")
      const ebayEmailsUk = await fetchEmails(
        `from:ebay@ebay.co.uk subject:"Order confirmed" newer_than:${days}d`
      );
      const ebayEmailsCom = await fetchEmails(
        `from:ebay@ebay.com subject:"Order confirmed" newer_than:${days}d`
      );
      const ebayWonUk = await fetchEmails(
        `from:ebay@ebay.co.uk subject:"You won" newer_than:${days}d`
      );
      const ebayWonCom = await fetchEmails(
        `from:ebay@ebay.com subject:"You won" newer_than:${days}d`
      );
      // Deduplicate by email ID in case an email matches multiple queries
      const ebayEmailMap = new Map<string, (typeof ebayEmailsUk)[number]>();
      for (const email of [...ebayEmailsUk, ...ebayEmailsCom, ...ebayWonUk, ...ebayWonCom]) {
        ebayEmailMap.set(email.id, email);
      }
      const ebayEmails = Array.from(ebayEmailMap.values());
      totalFetched += ebayEmails.length;
      console.log(
        `[scan-emails] Fetched ${ebayEmails.length} eBay emails from Gmail (${ebayEmailsUk.length} UK confirmed, ${ebayEmailsCom.length} COM confirmed, ${ebayWonUk.length} UK won, ${ebayWonCom.length} COM won, after dedup)`
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

        const candidate = parseEbayEmail(email);
        if (!candidate || !candidate.email_id) {
          console.warn(
            `[scan-emails] Failed to parse eBay email: id=${email.id} subject="${email.subject}" date=${email.date}`
          );
          continue;
        }
        totalParsed++;

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
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
