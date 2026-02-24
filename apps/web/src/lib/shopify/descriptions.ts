import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { sendMessage } from '@/lib/ai/claude-client';

interface InventoryItemData {
  condition: string | null;
  set_number: string | null;
  item_name: string | null;
}

interface BricksetData {
  set_number: string | null;
  theme: string | null;
  subtheme: string | null;
  pieces: number | null;
  minifigs: number | null;
  year_from: number | null;
  uk_retail_price: number | null;
}

/**
 * Completeness level for used sets, detected from the eBay description.
 *
 * - complete:        No issues mentioned
 * - almost_complete: Minor substitutions (different colour pieces, replaced plumes, etc.)
 * - incomplete:      Actually missing pieces
 */
type CompletenessLevel = 'complete' | 'almost_complete' | 'incomplete';

function detectCompleteness(ebayDescription: string | null | undefined): CompletenessLevel {
  if (!ebayDescription) return 'complete';
  const text = ebayDescription.toLowerCase();

  // Strip standard Hadley Bricks eBay boilerplate before checking keywords.
  // These are general disclaimers, not item-specific incompleteness.
  const boilerplatePhrases = [
    "if anything's missing",
    'may be missing from all used lego',
    'pieces may be missing',
    'broken or missing pieces are replaced',
    'missing pieces are replaced',
    'checked for completeness prior to listing',
    'listed as complete unless described',
    'not available on used lego given it is impossible',
    'please check listing carefully',
  ];
  let cleaned = text;
  for (const phrase of boilerplatePhrases) {
    // Remove the sentence containing each boilerplate phrase
    const idx = cleaned.indexOf(phrase);
    if (idx !== -1) {
      // Find sentence boundaries (period or paragraph)
      const sentenceStart = Math.max(0, cleaned.lastIndexOf('.', idx) + 1);
      const sentenceEnd = cleaned.indexOf('.', idx + phrase.length);
      cleaned =
        cleaned.substring(0, sentenceStart) +
        cleaned.substring(sentenceEnd !== -1 ? sentenceEnd + 1 : cleaned.length);
    }
  }

  // Red — actually missing pieces (checked against cleaned text)
  const missingIndicators = [
    'missing',
    'not included',
    'without the',
    'no longer has',
    'pieces short',
  ];
  const hasMissing = missingIndicators.some((term) => cleaned.includes(term));

  // Amber — minor substitutions / non-original pieces
  const substitutionIndicators = [
    'instead of',
    'substitute',
    'replaced with',
    'not original',
    'non-original',
    'wrong colour',
    'wrong color',
    'different colour',
    'different color',
    'rather than',
  ];
  const hasSubstitution = substitutionIndicators.some((term) => cleaned.includes(term));

  if (hasMissing) return 'incomplete';
  if (hasSubstitution) return 'almost_complete';

  return 'complete';
}

/**
 * Build a Shopify product description from inventory item + Brickset data.
 *
 * For eBay items: uses the eBay listing description (your own copy) with a
 * condition badge and buy-direct banner prepended/appended.
 *
 * For non-eBay items: generates structured HTML with condition badge,
 * set details, value proposition, and buy-direct messaging.
 */
export function buildShopifyDescription(
  item: InventoryItemData,
  bricksetData?: BricksetData | null,
  ebayDescription?: string | null,
  aiDescription?: string | null
): string {
  const parts: string[] = [];

  const isUsed =
    item.condition?.toLowerCase() === 'used' ||
    item.condition?.toLowerCase() === 'u';

  // Condition badges
  if (isUsed) {
    // Badge 1: Restored & Verified (always green for used)
    parts.push(
      '<div style="background:#27AE60;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:8px;margin-right:8px;font-weight:bold;">Restored & Verified</div>'
    );

    // Badge 2: Completeness level
    const completeness = detectCompleteness(ebayDescription);
    switch (completeness) {
      case 'almost_complete':
        parts.push(
          '<div style="background:#F5A623;color:#1B2A4A;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:bold;">Almost Complete &mdash; See Notes</div>'
        );
        break;
      case 'incomplete':
        parts.push(
          '<div style="background:#E74C3C;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:bold;">Incomplete &mdash; See Notes</div>'
        );
        break;
      default:
        parts.push(
          '<div style="background:#27AE60;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:bold;">Complete</div>'
        );
    }
  } else {
    parts.push(
      '<div style="background:#27AE60;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:bold;">Brand New & Sealed</div>'
    );
  }

  // Main body: eBay description OR AI-generated / fallback description
  if (ebayDescription) {
    // Strip eBay-specific messaging before using on Shopify
    const cleaned = sanitizeEbayDescription(ebayDescription);
    parts.push(`<div style="margin:16px 0;">${cleaned}</div>`);
  } else if (aiDescription) {
    // AI-generated description (for Amazon / non-eBay items)
    parts.push(`<div style="margin:16px 0;">${aiDescription}</div>`);
  } else {
    // Fallback: structured bullet list from Brickset data
    if (bricksetData) {
      parts.push('<ul style="margin:16px 0;padding-left:20px;">');

      if (bricksetData.set_number) {
        const displayNumber = bricksetData.set_number.replace(/-1$/, '');
        parts.push(`<li><strong>Set Number:</strong> ${displayNumber}</li>`);
      }

      if (bricksetData.theme) {
        const theme = bricksetData.subtheme
          ? `${bricksetData.theme} > ${bricksetData.subtheme}`
          : bricksetData.theme;
        parts.push(`<li><strong>Theme:</strong> ${theme}</li>`);
      }

      if (bricksetData.pieces) {
        parts.push(
          `<li><strong>Pieces:</strong> ${bricksetData.pieces.toLocaleString()}</li>`
        );
      }

      if (bricksetData.minifigs) {
        parts.push(
          `<li><strong>Minifigures:</strong> ${bricksetData.minifigs}</li>`
        );
      }

      if (bricksetData.year_from) {
        parts.push(`<li><strong>Year:</strong> ${bricksetData.year_from}</li>`);
      }

      parts.push('</ul>');
    }

    // Restoration value prop for used sets (only for fallback descriptions)
    if (isUsed) {
      parts.push(
        '<p style="margin:16px 0;">Every used set from Hadley Bricks is cleaned, sorted, and checked piece by piece to ensure completeness. Buy with confidence.</p>'
      );
    }
  }

  // Buy direct benefit (always shown)
  parts.push(
    '<p style="margin:16px 0;"><strong>Our cheapest price guaranteed</strong> &mdash; at least 10% off our listings on other platforms.</p>'
  );

  return parts.join('\n');
}

/**
 * Build a Shopify product title from inventory item data.
 *
 * Format: "LEGO {Theme}: {Name} ({SetNumber}) - {Condition}"
 */
export function buildShopifyTitle(
  item: InventoryItemData,
  bricksetData?: BricksetData | null,
  ebayDescription?: string | null
): string {
  const parts: string[] = ['LEGO'];

  // Add theme if available
  if (bricksetData?.theme) {
    parts.push(`${bricksetData.theme}:`);
  }

  // Add item name
  if (item.item_name) {
    // Remove "LEGO" prefix if already present
    const name = item.item_name.replace(/^LEGO\s*/i, '');
    parts.push(name);
  }

  // Add set number
  if (item.set_number && item.set_number !== 'NA') {
    parts.push(`(${item.set_number})`);
  }

  // Add condition
  const isUsed =
    item.condition?.toLowerCase() === 'used' ||
    item.condition?.toLowerCase() === 'u';
  if (isUsed) {
    const completeness = detectCompleteness(ebayDescription);
    switch (completeness) {
      case 'almost_complete':
        parts.push('- Almost Complete');
        break;
      case 'incomplete':
        parts.push('- Incomplete');
        break;
      default:
        parts.push('- Complete');
    }
  } else {
    parts.push('- New Sealed');
  }

  return parts.join(' ').substring(0, 255);
}

/**
 * Build Shopify tags from inventory item and Brickset data.
 */
export function buildShopifyTags(
  item: InventoryItemData,
  bricksetData?: BricksetData | null,
  ebayDescription?: string | null
): string {
  const tags: string[] = [];

  // Theme
  if (bricksetData?.theme) {
    tags.push(bricksetData.theme);
  }
  if (bricksetData?.subtheme) {
    tags.push(bricksetData.subtheme);
  }

  // Condition
  const isUsed =
    item.condition?.toLowerCase() === 'used' ||
    item.condition?.toLowerCase() === 'u';
  tags.push(isUsed ? 'Used' : 'New');
  tags.push(isUsed ? 'Restored' : 'Sealed');
  if (isUsed) {
    const completeness = detectCompleteness(ebayDescription);
    switch (completeness) {
      case 'almost_complete':
        tags.push('Almost Complete');
        break;
      case 'incomplete':
        tags.push('Incomplete');
        break;
      default:
        tags.push('Complete');
    }
  }

  // Set number
  if (item.set_number && item.set_number !== 'NA') {
    tags.push(item.set_number);
  }

  // Year
  if (bricksetData?.year_from) {
    tags.push(String(bricksetData.year_from));
  }

  return [...new Set(tags)].join(', ');
}

// ── AI Description Generation ────────────────────────────────────

const SHOPIFY_DESCRIPTION_SYSTEM_PROMPT = `You are a product copywriter for Hadley Bricks, a specialist LEGO reseller.
Write a short, engaging Shopify product description in HTML.

Rules:
- 100-200 words maximum
- Use simple HTML only: <p>, <b>, <ul>, <li>
- Highlight what makes this set special — theme, play features, display appeal, collectibility
- Mention piece count and minifigure count naturally in the text (don't list them as specs)
- Do NOT include the set number, price, RRP, shipping info, or condition
- Do NOT include any heading tags (<h1>, <h2>, etc.)
- Write for a buyer who already knows it's LEGO — focus on why THIS set is worth buying
- Tone: knowledgeable, enthusiastic but not over-the-top
- If the set is retired, mention it's no longer available in shops
- Return ONLY the HTML, nothing else`;

/**
 * Read a pre-generated AI description from the cache table.
 * Descriptions are generated by Claude in the CLI conversation and stored
 * in shopify_description_cache before running the sync.
 */
export async function getCachedAIDescription(
  supabase: SupabaseClient<Database>,
  inventoryItemId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('shopify_description_cache')
    .select('description_html')
    .eq('inventory_item_id', inventoryItemId)
    .single();

  return data?.description_html ?? null;
}

/**
 * Get an AI description from cache, or generate one via Claude Haiku.
 *
 * Lookup order:
 * 1. Cache by inventory_item_id
 * 2. Cache by set_number (reuse across duplicate items of the same set)
 * 3. Generate via Claude Haiku and cache the result
 */
export async function getOrGenerateAIDescription(
  supabase: SupabaseClient<Database>,
  inventoryItemId: string,
  setNumber: string,
  context: {
    item_name: string | null;
    condition: string | null;
    theme: string | null;
    subtheme: string | null;
    pieces: number | null;
    minifigs: number | null;
    year: number | null;
    rrp: number | null;
  }
): Promise<string | null> {
  // 1. Check cache by inventory_item_id
  const { data: byId } = await supabase
    .from('shopify_description_cache')
    .select('description_html')
    .eq('inventory_item_id', inventoryItemId)
    .single();

  if (byId?.description_html) return byId.description_html;

  // 2. Check cache by set_number (reuse from another item of same set)
  const { data: bySet } = await supabase
    .from('shopify_description_cache')
    .select('description_html')
    .eq('set_number', setNumber)
    .limit(1)
    .single();

  if (bySet?.description_html) {
    // Cache for this item too so future lookups are fast
    await supabase.from('shopify_description_cache').insert({
      inventory_item_id: inventoryItemId,
      set_number: setNumber,
      description_html: bySet.description_html,
    });
    return bySet.description_html;
  }

  // 3. Generate via Claude Haiku
  try {
    const userPrompt = buildDescriptionPrompt(setNumber, context);
    const html = await sendMessage(
      SHOPIFY_DESCRIPTION_SYSTEM_PROMPT,
      userPrompt,
      {
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1024,
        temperature: 0.4,
      }
    );

    if (!html || html.trim().length < 20) return null;

    // Cache the result
    await supabase.from('shopify_description_cache').insert({
      inventory_item_id: inventoryItemId,
      set_number: setNumber,
      description_html: html.trim(),
    });

    return html.trim();
  } catch (err) {
    console.warn(`[Descriptions] AI generation failed for ${setNumber}:`, err);
    return null;
  }
}

/**
 * Build the user prompt for AI description generation.
 */
function buildDescriptionPrompt(
  setNumber: string,
  context: {
    item_name: string | null;
    condition: string | null;
    theme: string | null;
    subtheme: string | null;
    pieces: number | null;
    minifigs: number | null;
    year: number | null;
    rrp: number | null;
  }
): string {
  const lines: string[] = [];
  lines.push(`Set: ${context.item_name ?? setNumber}`);
  if (context.theme) {
    const theme = context.subtheme
      ? `${context.theme} > ${context.subtheme}`
      : context.theme;
    lines.push(`Theme: ${theme}`);
  }
  if (context.pieces) lines.push(`Pieces: ${context.pieces}`);
  if (context.minifigs) lines.push(`Minifigures: ${context.minifigs}`);
  if (context.year) {
    lines.push(`Year: ${context.year}`);
    if (context.year < 2023) lines.push('Status: Retired (no longer available in shops)');
  }
  if (context.condition) lines.push(`Condition: ${context.condition}`);
  if (context.rrp) lines.push(`Original RRP: £${context.rrp}`);

  return lines.join('\n');
}

/**
 * Build a plain-text SEO meta description for the product (max 160 chars).
 * Used as the Shopify `global.description_tag` metafield to prevent
 * auto-generation from body_html (which causes double-encoded entities).
 */
export function buildSeoDescription(
  item: InventoryItemData,
  bricksetData?: BricksetData | null
): string {
  const parts: string[] = [];
  const setNum = item.set_number && item.set_number !== 'NA'
    ? item.set_number.replace(/-1$/, '')
    : null;

  const isUsed =
    item.condition?.toLowerCase() === 'used' ||
    item.condition?.toLowerCase() === 'u';

  // Opening: "LEGO {Theme} {Name} ({SetNum})"
  parts.push('LEGO');
  if (bricksetData?.theme) parts.push(bricksetData.theme);
  if (item.item_name) {
    parts.push(item.item_name.replace(/^LEGO\s*/i, ''));
  }
  if (setNum) parts.push(`(${setNum})`);

  let desc = parts.join(' ');

  // Condition + key details
  if (isUsed) {
    desc += '. Restored & verified piece-by-piece.';
  } else {
    desc += '. Brand new & sealed.';
  }

  if (bricksetData?.pieces) {
    desc += ` ${bricksetData.pieces} pieces.`;
  }

  // Closer
  desc += ' Shop at Hadley Bricks - at least 10% off marketplace prices.';

  // Trim to 160 chars
  if (desc.length > 160) {
    desc = desc.substring(0, 157) + '...';
  }

  return desc;
}

/**
 * Strip eBay-specific messaging from listing descriptions.
 * Removes phrases that reference eBay directly and don't make sense on Shopify.
 */
function sanitizeEbayDescription(html: string): string {
  // Phrases to remove (case-insensitive, handles surrounding whitespace/tags)
  const patternsToRemove = [
    /Questions or concerns\?\s*Just message us via eBay\.?\s*New sets added daily!?\s*/gi,
    /Questions or concerns\?\s*Just message us via eBay\.?\s*/gi,
    /New sets added daily!?\s*/gi,
    /Just message us via eBay\.?\s*/gi,
    /message us via eBay/gi,
  ];

  let cleaned = html;
  for (const pattern of patternsToRemove) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up any empty paragraphs or divs left behind
  cleaned = cleaned.replace(/<p>\s*<\/p>/gi, '');
  cleaned = cleaned.replace(/<div>\s*<\/div>/gi, '');
  cleaned = cleaned.replace(/<br\s*\/?>\s*<br\s*\/?>\s*<br\s*\/?>/gi, '<br><br>');

  return cleaned.trim();
}
