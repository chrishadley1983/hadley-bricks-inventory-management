/**
 * ASIN resolution for a LEGO set.
 *
 * Two independent sources, neither trustworthy on its own:
 *
 *  - `seeded_asins` — curated, but partly populated by `title_fuzzy` matching, which
 *    drifts onto accessories. 75192's seeded ASIN is "Millionspring Millennium Falcon
 *    Vertical Display Stand" at confidence 69: a third-party stand, not the set.
 *  - The SP-API catalogue search by EAN/UPC — accurate when it hits, but it does not
 *    always surface the live listing. For 71741 it returns B08W5BV3HT (£396.99, no
 *    Buy Box) and never B099HSJJCP, the ASIN that actually holds the £344.99 Buy Box.
 *
 * So neither "prefer seeded" nor "take items[0]" is right. Both are treated as
 * candidates and verified against the title before use.
 */

/** Third-party tat that fuzzy title matching keeps landing on. */
const ACCESSORY_PATTERNS: RegExp[] = [
  /\bdisplay\s+stand\b/i,
  /\bdisplay\s+case\b/i,
  /\bwall\s+mount(ing)?\b/i,
  /\bacrylic\b/i,
  /\blight(ing)?\s+kit\b/i,
  /\bled\s+light/i,
  /\bcompatible\s+with\b/i,
  /\bfor\s+lego\b/i,
  /\bstickers?\s+only\b/i,
  /\binstructions?\s+only\b/i,
  /\breplacement\b/i,
];

export interface AsinCandidate {
  asin: string;
  title: string | null;
  /** Where it came from, for logging and for tie-breaking. */
  source: 'seeded' | 'catalog';
}

export interface AsinVerdict {
  ok: boolean;
  reason: string;
}

/** Bare set number: "75192-1" -> "75192". */
export function bareSetNumber(setNumber: string): string {
  return setNumber.trim().replace(/-\d+$/, '');
}

/**
 * Does this title plausibly describe the SET itself?
 *
 * Deliberately strict on the set number: an Amazon title for a real LEGO set almost
 * always carries it, and requiring it is what rejects the display-stand class of
 * mismatch that fuzzy seeding introduces.
 */
export function verifyAsinTitle(title: string | null, setNumber: string): AsinVerdict {
  if (!title) return { ok: false, reason: 'no title to verify' };

  const lower = title.toLowerCase();
  if (!lower.includes('lego')) return { ok: false, reason: 'title does not mention LEGO' };

  for (const pattern of ACCESSORY_PATTERNS) {
    if (pattern.test(title)) {
      return { ok: false, reason: `looks like an accessory (${pattern.source})` };
    }
  }

  const bare = bareSetNumber(setNumber);
  if (!title.includes(bare)) {
    return { ok: false, reason: `title does not contain set number ${bare}` };
  }

  return { ok: true, reason: 'title carries LEGO + the set number' };
}

export interface AsinChoice {
  asin: string | null;
  source: 'seeded' | 'catalog' | 'catalog-unverified' | null;
  /** Why this one, or why nothing — surfaced so a wrong price is traceable. */
  reason: string;
}

/**
 * Pick the ASIN to price.
 *
 * Seeded first WHEN IT VERIFIES (it is the curated answer and, for 71741, the only
 * source that knows about the Buy Box-winning listing). Otherwise the first catalogue
 * hit that verifies. Failing both, the first catalogue hit is used but flagged, so the
 * panel can say the match is unconfirmed rather than presenting a guess as fact.
 */
export function pickBestAsin(candidates: AsinCandidate[], setNumber: string): AsinChoice {
  const seeded = candidates.filter((c) => c.source === 'seeded');
  const catalog = candidates.filter((c) => c.source === 'catalog');

  for (const c of [...seeded, ...catalog]) {
    const verdict = verifyAsinTitle(c.title, setNumber);
    if (verdict.ok) {
      return { asin: c.asin, source: c.source, reason: `${c.source}: ${verdict.reason}` };
    }
  }

  if (catalog.length > 0) {
    const first = catalog[0];
    return {
      asin: first.asin,
      source: 'catalog-unverified',
      reason: `no candidate verified; using first catalogue hit (${
        verifyAsinTitle(first.title, setNumber).reason
      })`,
    };
  }

  return { asin: null, source: null, reason: 'no ASIN candidates' };
}
