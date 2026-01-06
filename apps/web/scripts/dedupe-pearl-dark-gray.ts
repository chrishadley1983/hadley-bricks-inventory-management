/**
 * Quick script to deduplicate Pearl Dark Gray inventory by Lego ID
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const csvPath = resolve(__dirname, '../pearl-dark-gray-inventory.csv');
const csv = readFileSync(csvPath, 'utf-8');
const lines = csv.split('\n').slice(1).filter((l) => l.trim());

// Parse and group by Lego ID (unique piece definition)
const byLegoId = new Map<string, { lots: number; qty: number; value: number }>();
// Also try Lego ID + Condition
const byLegoIdCondition = new Map<string, { lots: number; qty: number; value: number }>();

for (const line of lines) {
  // Parse CSV properly (handle quoted fields)
  const match = line.match(/^(\d+),"([^"]*)","?([^",]+)"?,"([^"]*)",([^,]+),(\d+),([\d.]+),([\d.]+)/);
  if (!match) continue;

  const legoId = match[3]; // Lego ID column
  const condition = match[5]; // Condition column
  const qty = parseInt(match[6]) || 0;
  const value = parseFloat(match[8]) || 0;

  // By Lego ID only
  if (!byLegoId.has(legoId)) {
    byLegoId.set(legoId, { lots: 0, qty: 0, value: 0 });
  }
  const entry = byLegoId.get(legoId)!;
  entry.lots++;
  entry.qty += qty;
  entry.value += value;

  // By Lego ID + Condition
  const key = `${legoId}|${condition}`;
  if (!byLegoIdCondition.has(key)) {
    byLegoIdCondition.set(key, { lots: 0, qty: 0, value: 0 });
  }
  const entry2 = byLegoIdCondition.get(key)!;
  entry2.lots++;
  entry2.qty += qty;
  entry2.value += value;
}

console.log('Pearl Dark Gray - Deduplicated by Lego ID:');
console.log(`  Unique pieces: ${byLegoId.size} (UI shows 137)`);

let totalQty = 0;
let totalValue = 0;
for (const data of byLegoId.values()) {
  totalQty += data.qty;
  totalValue += data.value;
}
console.log(`  Total quantity: ${totalQty} (UI shows 363)`);
console.log(`  Total value: £${totalValue.toFixed(2)} (UI shows £183.81)`);
console.log('');

console.log('');
console.log('Pearl Dark Gray - Deduplicated by Lego ID + Condition:');
console.log(`  Unique pieces: ${byLegoIdCondition.size} (UI shows 137)`);

if (byLegoId.size === 137) {
  console.log('');
  console.log('✓ MATCH on Lego ID only!');
} else if (byLegoIdCondition.size === 137) {
  console.log('');
  console.log('✓ MATCH on Lego ID + Condition!');
} else {
  console.log('');
  console.log(`Closest match: ${Math.abs(byLegoId.size - 137) < Math.abs(byLegoIdCondition.size - 137) ? 'Lego ID only' : 'Lego ID + Condition'}`);
  console.log(`Difference: ${Math.min(Math.abs(byLegoId.size - 137), Math.abs(byLegoIdCondition.size - 137))} pieces`);
  console.log('');
  console.log('This small difference is likely due to inventory changes between screenshot and scan.');
}
