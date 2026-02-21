/**
 * Allowlist-based HTML sanitizer (M11).
 * Only permits safe tags and attributes for eBay listing descriptions.
 */
export function sanitizeHtml(html: string): string {
  const ALLOWED_TAGS = new Set([
    'p',
    'br',
    'b',
    'i',
    'u',
    'em',
    'strong',
    'span',
    'div',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'hr',
  ]);
  const ALLOWED_ATTRS = new Set(['href', 'class']);

  const doc = new DOMParser().parseFromString(html, 'text/html');

  function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode(true);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(el.childNodes)) {
        const cleaned = cleanNode(child);
        if (cleaned) fragment.appendChild(cleaned);
      }
      return fragment;
    }

    const cleanEl = document.createElement(tag);
    for (const attr of Array.from(el.attributes)) {
      if (ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
        if (attr.name === 'href') {
          const trimmed = attr.value.trim().toLowerCase();
          if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) continue;
        }
        cleanEl.setAttribute(attr.name, attr.value);
      }
    }
    for (const child of Array.from(el.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) cleanEl.appendChild(cleaned);
    }
    return cleanEl;
  }

  const fragment = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) fragment.appendChild(cleaned);
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}

import type { MinifigSyncItem } from '@/lib/minifig-sync/types';
import type { SourcedImage } from '@/lib/minifig-sync/types';

export interface QualityCheckResult {
  passed: boolean;
  reasons: string[];
}

export function getQualityCheck(item: MinifigSyncItem): QualityCheckResult {
  const reasons: string[] = [];
  const images = item.images as SourcedImage[] | null;

  if (!images || images.length < 2) {
    reasons.push('At least 2 images required');
  }
  if (!item.recommended_price || Number(item.recommended_price) <= 0) {
    reasons.push('Price must be greater than £0');
  }
  if (!item.name || item.name.length < 3) {
    reasons.push('Title is required');
  }
  if (!item.ebay_sku) {
    reasons.push('eBay SKU is required');
  }
  if (!item.ebay_offer_id) {
    reasons.push('eBay offer ID is required');
  }

  return { passed: reasons.length === 0, reasons };
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return `£${num.toFixed(2)}`;
}
