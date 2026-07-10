#!/usr/bin/env node
/**
 * generate-bsx.js — build a BrickStore .bsx file from a basket JSON.
 *
 * Usage:
 *   node generate-bsx.js <basket.json> <output.bsx>
 *
 * basket.json: array of lines:
 *   {
 *     "part": "3249",          // BL item no (required)
 *     "colorId": 11,            // BL color id (required)
 *     "qty": 100,               // (required)
 *     "price": 0.80,            // intended sell price GBP (required)
 *     "cost": 0.29,             // per-unit cost GBP (optional)
 *     "condition": "N",        // optional, default N
 *     "itemName": "...",       // optional, informational
 *     "remarks": "...",        // optional -> BSX Remarks (storage/batch ref)
 *     "comments": "..."        // optional -> BSX Comments (public)
 *   }
 *
 * BrickStore resolves item/colour names from its own catalog via
 * ItemID+ItemTypeID+ColorID, so names are optional.
 */
const fs = require('fs');

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node generate-bsx.js <basket.json> <output.bsx>');
  process.exit(1);
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const lines = JSON.parse(fs.readFileSync(inPath, 'utf8'));
if (!Array.isArray(lines) || lines.length === 0) {
  console.error('basket.json must be a non-empty array');
  process.exit(1);
}

const items = lines
  .map((l) => {
    if (!l.part || l.colorId == null || !l.qty || l.price == null) {
      throw new Error('line missing part/colorId/qty/price: ' + JSON.stringify(l));
    }
    const opt = [];
    if (l.itemName) opt.push(`   <ItemName>${esc(l.itemName)}</ItemName>`);
    if (l.cost != null) opt.push(`   <Cost>${Number(l.cost).toFixed(3)}</Cost>`);
    if (l.comments) opt.push(`   <Comments>${esc(l.comments)}</Comments>`);
    if (l.remarks) opt.push(`   <Remarks>${esc(l.remarks)}</Remarks>`);
    return [
      '  <Item>',
      `   <ItemID>${esc(l.part)}</ItemID>`,
      '   <ItemTypeID>P</ItemTypeID>',
      `   <ColorID>${l.colorId}</ColorID>`,
      `   <Qty>${l.qty}</Qty>`,
      `   <Price>${Number(l.price).toFixed(3)}</Price>`,
      `   <Condition>${l.condition || 'N'}</Condition>`,
      ...opt,
      '  </Item>',
    ].join('\n');
  })
  .join('\n');

const bsx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE BrickStoreXML>
<BrickStoreXML>
 <Inventory>
${items}
 </Inventory>
</BrickStoreXML>
`;

fs.writeFileSync(outPath, bsx);
const totalQty = lines.reduce((a, l) => a + l.qty, 0);
const totalCost = lines.reduce((a, l) => a + (l.cost || 0) * l.qty, 0);
console.log(
  `wrote ${outPath}: ${lines.length} lots, ${totalQty} pieces` +
    (totalCost ? `, cost £${totalCost.toFixed(2)}` : '')
);
