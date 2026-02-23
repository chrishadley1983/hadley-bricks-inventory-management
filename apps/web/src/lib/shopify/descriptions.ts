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
 * Build a Shopify product description from inventory item + Brickset data.
 *
 * Generates structured HTML with condition badge, set details,
 * value proposition, and buy-direct messaging.
 */
export function buildShopifyDescription(
  item: InventoryItemData,
  bricksetData?: BricksetData | null
): string {
  const parts: string[] = [];

  // Condition badge
  const isUsed =
    item.condition?.toLowerCase() === 'used' ||
    item.condition?.toLowerCase() === 'u';

  if (isUsed) {
    parts.push(
      '<div style="background:#27AE60;color:#fff;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:bold;">Restored &amp; Verified Complete</div>'
    );
  } else {
    parts.push(
      '<div style="background:#F5A623;color:#1B2A4A;padding:8px 16px;border-radius:6px;display:inline-block;margin-bottom:16px;font-weight:bold;">Brand New &amp; Sealed</div>'
    );
  }

  // Set details from Brickset
  if (bricksetData) {
    parts.push('<ul style="margin:16px 0;padding-left:20px;">');

    if (bricksetData.set_number) {
      const displayNumber = bricksetData.set_number.replace(/-1$/, '');
      parts.push(`<li><strong>Set Number:</strong> ${displayNumber}</li>`);
    }

    if (bricksetData.theme) {
      const theme = bricksetData.subtheme
        ? `${bricksetData.theme} &gt; ${bricksetData.subtheme}`
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

    if (bricksetData.uk_retail_price) {
      parts.push(
        `<li><strong>Original RRP:</strong> &pound;${bricksetData.uk_retail_price.toFixed(2)}</li>`
      );
    }

    parts.push('</ul>');
  }

  // Restoration value prop for used sets
  if (isUsed) {
    parts.push(
      '<p style="margin:16px 0;">Every used set from Hadley Bricks is cleaned, sorted, and checked piece by piece to ensure completeness. Buy with confidence.</p>'
    );
  }

  // Buy direct benefit
  parts.push(
    '<p style="margin:16px 0;padding:12px 16px;background:#F8F6F3;border-radius:6px;"><strong>Buy direct and save</strong> &mdash; this item is priced below our marketplace listings because there are no eBay or Amazon fees.</p>'
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
  bricksetData?: BricksetData | null
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
  parts.push(isUsed ? '- Complete' : '- New Sealed');

  return parts.join(' ').substring(0, 255);
}

/**
 * Build Shopify tags from inventory item and Brickset data.
 */
export function buildShopifyTags(
  item: InventoryItemData,
  bricksetData?: BricksetData | null
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
  if (isUsed) tags.push('Complete');

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
