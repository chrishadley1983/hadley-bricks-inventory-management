/**
 * eBay Listing Description Generator (F34, F35, E7)
 *
 * Uses Claude API to generate HTML descriptions for minifig listings.
 * Falls back to a template-based description on Claude API failure.
 */

import { sendMessage } from '@/lib/ai/claude-client';
import { RebrickableApiClient } from '@/lib/rebrickable';
import type { RebrickableMinifigSet } from '@/lib/rebrickable';

interface DescriptionInput {
  name: string;
  bricklinkId: string;
  conditionNotes?: string | null;
  rebrickableApiKey: string;
}

const SYSTEM_PROMPT = `You are an eBay listing description writer for LEGO minifigures.
Write a concise HTML description (under 300 words) for the minifigure listing.

Include these sections:
1. Minifigure identification (name and BrickLink catalog ID)
2. Set appearances (which LEGO sets this minifig appears in)
3. Condition description (used/pre-owned, any specific notes)
4. What's included (the minifigure and any accessories)
5. A brief collectibility/appeal note

Format as clean HTML using <h3>, <p>, and <ul> tags. No inline styles.
Do not include <html>, <head>, or <body> tags.
Keep the tone professional and informative.`;

/**
 * Generate an eBay listing description using Claude API.
 * Falls back to a template on failure (E7).
 */
export async function generateDescription(
  input: DescriptionInput,
): Promise<string> {
  try {
    // Fetch set appearances from Rebrickable (F35)
    let sets: RebrickableMinifigSet[] = [];
    try {
      const client = new RebrickableApiClient(input.rebrickableApiKey);
      sets = await client.getMinifigSets(input.bricklinkId);
    } catch (err) {
      console.warn(
        `[DescriptionGenerator] Failed to fetch Rebrickable sets for ${input.bricklinkId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    const setList =
      sets.length > 0
        ? sets
            .slice(0, 10)
            .map((s) => `${s.set_num} - ${s.set_name}`)
            .join('\n')
        : 'Set appearances not available';

    const userMessage = `Generate an eBay listing description for this LEGO minifigure:

Name: ${input.name}
BrickLink Catalog ID: ${input.bricklinkId}
Condition: Used / Pre-owned${input.conditionNotes ? `\nCondition Notes: ${input.conditionNotes}` : ''}

Set Appearances:
${setList}

Generate the HTML description now.`;

    const description = await sendMessage(SYSTEM_PROMPT, userMessage, {
      maxTokens: 1024,
      temperature: 0.4,
    });

    return description;
  } catch (err) {
    // E7: Fallback to template-based description on Claude failure
    console.warn(
      `[DescriptionGenerator] Claude API failed for ${input.bricklinkId}, using fallback:`,
      err instanceof Error ? err.message : err,
    );
    return generateFallbackDescription(input);
  }
}

/**
 * Template-based fallback description (E7).
 * Contains minifig name, BrickLink ID, and condition.
 */
function generateFallbackDescription(input: DescriptionInput): string {
  const conditionLine = input.conditionNotes
    ? `<p>Condition notes: ${escapeHtml(input.conditionNotes)}</p>`
    : '';

  return `<h3>LEGO Minifigure: ${escapeHtml(input.name)}</h3>
<p>BrickLink Catalog ID: ${escapeHtml(input.bricklinkId)}</p>
<p>Condition: Used / Pre-owned — this minifigure has been carefully stored and is in excellent condition.</p>
${conditionLine}
<h3>What's Included</h3>
<ul>
<li>LEGO ${escapeHtml(input.name)} minifigure</li>
<li>All original accessories where applicable</li>
</ul>
<h3>About This Minifigure</h3>
<p>Authentic LEGO minifigure from the official LEGO range. Perfect for collectors, MOC builders, or completing your LEGO sets.</p>
<p>Check the BrickLink catalog (${escapeHtml(input.bricklinkId)}) for full details on set appearances and rarity.</p>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
