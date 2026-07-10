/**
 * BL store-directory discovery — the quarterly "find new England stores" feed.
 *
 * Scrapes https://www.bricklink.com/browseStores.asp?countryID=UK&groupState=Y
 * (ONE page listing all ~1,900 open UK stores in state groups) via the logged-in
 * CDP Chrome, and extracts the England group only. Deliberately slow: a single
 * navigation with a generous settle wait — this runs four times a year.
 *
 * Page structure (recon 2026-07-10): stores render as
 *   <a href="store.asp?p=<username>">Store Name</a> - 12,345<br>
 * inside three-column <td>s, with state group headings as bare
 * <b><font>England</font></b> elements in document order. The `p=` username IS
 * the store slug used by store.bricklink.com/<slug>. Stores before the first
 * state heading (or under other states) are ignored.
 */
import type { CDPClient } from './store-scrape';

export interface DirectoryStore {
  slug: string;
  name: string;
  /** Advertised item count next to the store link (thousands separators stripped). */
  items: number;
}

const DIRECTORY_URL = 'https://www.bricklink.com/browseStores.asp?countryID=UK&groupState=Y';
const STATE_NAMES = ['England', 'Scotland', 'Wales', 'Northern Ireland'];

export async function scrapeEnglandStores(
  cdp: CDPClient,
  opts: { settleMs?: number } = {},
): Promise<{ stores: DirectoryStore[]; totalUkOpen: number | null }> {
  await cdp.navigate(DIRECTORY_URL, opts.settleMs ?? 12000);

  const raw = await cdp.evaluate<string>(`(() => {
    const STATES = ${JSON.stringify(STATE_NAMES)};
    const stores = [];
    let current = null;
    // Walk elements in document order: state headings flip \`current\`; store
    // anchors are collected while inside the England group.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if ((el.tagName === 'B' || el.tagName === 'FONT') && STATES.includes(el.textContent.trim())) {
        // Ignore the jump-link legend at the top: legend entries are <a>-wrapped;
        // group headings are plain <b>/<font> (no anchor ancestor).
        if (!el.closest('a')) current = el.textContent.trim();
        continue;
      }
      if (current === 'England' && el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        const m = href.match(/^store\\.asp\\?p=([^&]+)/i);
        if (!m) continue;
        // Item count: the text node right after the anchor (or its icon sibling)
        // looks like " - 12,345".
        let n = el.nextSibling;
        let count = null;
        for (let hops = 0; n && hops < 4; hops++, n = n.nextSibling) {
          const t = (n.textContent || '').trim();
          const cm = t.match(/-\\s*([\\d,]+)/);
          if (cm) { count = parseInt(cm[1].replace(/,/g, ''), 10); break; }
        }
        stores.push({ slug: decodeURIComponent(m[1]), name: el.textContent.trim(), items: count ?? 0 });
      }
    }
    const totalM = (document.body.innerText || '').match(/([\\d,]+)\\s+Open Stores/i);
    return JSON.stringify({ stores, totalUkOpen: totalM ? parseInt(totalM[1].replace(/,/g, ''), 10) : null });
  })()`);

  const parsed = JSON.parse(raw) as { stores: DirectoryStore[]; totalUkOpen: number | null };
  // Dedupe by slug (a store shouldn't repeat, but the page is old-school HTML).
  const seen = new Set<string>();
  parsed.stores = parsed.stores.filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true)));
  return parsed;
}
