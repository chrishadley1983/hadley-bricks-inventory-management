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
}

// Hadley API base URL
const HADLEY_API_BASE = 'http://172.19.64.1:8100';

/**
 * Fetch emails from Hadley API Gmail endpoint
 */
async function fetchEmails(query: string): Promise<Array<{
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
}>> {
  try {
    const response = await fetch(
      `${HADLEY_API_BASE}/gmail/search?q=${encodeURIComponent(query)}&maxResults=50`
    );

    if (!response.ok) {
      console.error(`[scan-emails] Gmail search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    // Ensure we return an array
    if (Array.isArray(data.messages)) return data.messages;
    if (Array.isArray(data)) return data;
    return [];
  } catch (error) {
    console.error('[scan-emails] Failed to fetch emails:', error);
    return [];
  }
}

/**
 * Parse Vinted purchase confirmation email
 */
function parseVintedEmail(email: {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
}): Partial<PurchaseCandidate> | null {
  // Subject pattern: "You bought [Item Name]"
  const subjectMatch = email.subject.match(/You bought (.+)/i);
  if (!subjectMatch) return null;

  const itemName = subjectMatch[1];
  const content = email.body || email.snippet;

  // Extract price: "for £XX.XX"
  const priceMatch = content.match(/for £([\d.]+)/);
  const cost = priceMatch ? parseFloat(priceMatch[1]) : 0;

  // Extract seller: "from @username" or "from username"
  const sellerMatch = content.match(/from @?([^\s]+) for/i);
  const seller = sellerMatch ? sellerMatch[1] : 'unknown';

  // Extract order reference: various patterns
  const orderMatch = content.match(/(?:Order|Transaction|order number)[:\s]*(\d+)/i);
  const orderRef = orderMatch ? orderMatch[1] : `vinted-${email.id}`;

  // Try to extract set number from item name
  const setNumberMatch = itemName.match(/\b(\d{4,5})(?:-\d)?\b/);
  const setNumber = setNumberMatch ? setNumberMatch[1] : null;

  return {
    source: 'Vinted',
    order_reference: orderRef,
    seller_username: seller,
    item_name: itemName,
    set_number: setNumber,
    cost,
    purchase_date: new Date(email.date).toISOString().split('T')[0],
    email_id: email.id,
    email_subject: email.subject,
    email_date: email.date,
    payment_method: 'Monzo Card',
    suggested_condition: 'New', // Vinted always New
    skip_reason: setNumber ? undefined : 'no_set_number',
  };
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

  const itemName = subjectMatch[1];
  const content = email.body || email.snippet;

  // Extract price: "Item price: £XX.XX" or "Total: £XX.XX"
  const priceMatch = content.match(/(?:Item price|Total|Price)[:\s]*£([\d.]+)/i);
  const cost = priceMatch ? parseFloat(priceMatch[1]) : 0;

  // Extract seller
  const sellerMatch = content.match(/(?:Seller|Sold by)[:\s]*([^\n<]+)/i);
  const seller = sellerMatch ? sellerMatch[1].trim() : 'unknown';

  // Extract order reference: eBay uses format like "12-34567-89012"
  const orderMatch = content.match(/(?:Order number|Order #|Item #)[:\s]*([\d-]+)/i);
  const orderRef = orderMatch ? orderMatch[1] : `ebay-${email.id}`;

  // Try to extract set number from item name
  const setNumberMatch = itemName.match(/\b(\d{4,5})(?:-\d)?\b/);
  const setNumber = setNumberMatch ? setNumberMatch[1] : null;

  // Infer condition from item name
  const isSealed = /sealed|bnib|new|unopened|misb/i.test(itemName);

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
    suggested_condition: isSealed ? 'New' : 'Used',
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

      // Search Vinted emails
      const vintedEmails = await fetchEmails(
        `from:noreply@vinted.co.uk subject:"You bought" newer_than:${days}d`
      );

      for (const email of vintedEmails) {
        // Skip emails before cutoff date
        const emailDate = new Date(email.date);
        if (emailDate < CUTOFF_DATE) {
          continue;
        }

        const candidate = parseVintedEmail(email);
        if (candidate && candidate.email_id) {
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

      // Search eBay emails (both .co.uk and .com domains)
      const ebayEmailsUk = await fetchEmails(
        `from:ebay@ebay.co.uk subject:"Order confirmed" newer_than:${days}d`
      );
      const ebayEmailsCom = await fetchEmails(
        `from:ebay@ebay.com subject:"Order confirmed" newer_than:${days}d`
      );
      const ebayEmails = [...ebayEmailsUk, ...ebayEmailsCom];

      for (const email of ebayEmails) {
        // Skip emails before cutoff date
        const emailDate = new Date(email.date);
        if (emailDate < CUTOFF_DATE) {
          continue;
        }

        const candidate = parseEbayEmail(email);
        if (candidate && candidate.email_id) {
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

      return NextResponse.json({
        data: {
          candidates: readyToImport,
          needs_review: needsReview,
          already_processed_count: alreadyProcessedCount,
          total_found: allCandidates.length,
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
