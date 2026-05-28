/**
 * Audit the "Monzo Transactions" tab for mis-categorised rows in a target
 * month range (defaults to April + May 2026).
 *
 * Run with:
 *   npx tsx scripts/audit-monzo-categories.ts
 *   npx tsx scripts/audit-monzo-categories.ts --from 2026-04 --to 2026-05
 *
 * Credentials (any one of):
 *   - GOOGLE_CREDENTIALS_PATH pointing at the service-account JSON key, or
 *   - apps/web/google-credentials.json present, or
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY[_BASE64] in .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(__dirname, '../.env.local') });

import { GoogleSheetsClient } from '../src/lib/google/sheets-client';

const SHEET_NAME_MATCH = /monzo/i;

function parseMonthArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

// Inclusive YYYY-MM range. Defaults to April–May 2026.
const FROM = parseMonthArg('--from', '2026-04');
const TO = parseMonthArg('--to', '2026-05');

function resolveCredentials(): { email: string; key: string; spreadsheetId: string } {
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  const spreadsheetId =
    process.env.GOOGLE_SHEETS_ID || '1pmfxrFF4U08gXzsZOd49z4gbmmRHDrE_S8Vb6JqCMnU';

  const jsonPaths = [
    process.env.GOOGLE_CREDENTIALS_PATH,
    resolve(__dirname, '../google-credentials.json'),
    resolve(__dirname, '../../../google-credentials.json'),
  ].filter(Boolean) as string[];

  for (const p of jsonPaths) {
    if (existsSync(p)) {
      const creds = JSON.parse(readFileSync(p, 'utf-8'));
      email = creds.client_email;
      key = creds.private_key;
      break;
    }
  }

  if (!key && process.env.GOOGLE_PRIVATE_KEY_BASE64) {
    key = Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, 'base64').toString('utf-8');
  } else if (key) {
    key = key.replace(/\\n/g, '\n');
  }

  return { email, key, spreadsheetId };
}

// Accepts dd/mm/yyyy, d/m/yyyy, yyyy-mm-dd; returns YYYY-MM or null.
function toYearMonth(raw: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2].padStart(2, '0')}`;
  }
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  return null;
}

function findColumn(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test((h || '').trim()));
    if (i !== -1) return i;
  }
  return -1;
}

async function main() {
  const { email, key, spreadsheetId } = resolveCredentials();
  if (!email || !key) {
    console.error('Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and');
    console.error('GOOGLE_PRIVATE_KEY[_BASE64] in .env.local, or provide google-credentials.json.');
    process.exit(1);
  }

  const client = new GoogleSheetsClient({ serviceAccountEmail: email, privateKey: key, spreadsheetId });

  const conn = await client.testConnection();
  if (!conn.success) {
    console.error('Connection failed:', conn.message);
    process.exit(1);
  }
  console.log(`Connected to: ${conn.spreadsheetTitle}\n`);

  const sheets = await client.listSheets();
  const target = sheets.find((s) => SHEET_NAME_MATCH.test(s.title));
  if (!target) {
    console.error('No sheet matching /monzo/i found. Available tabs:');
    sheets.forEach((s) => console.error(`  - ${s.title}`));
    process.exit(1);
  }
  console.log(`Auditing tab: "${target.title}" (${target.rowCount} rows)\n`);

  const rows = await client.readRange(`'${target.title}'`);
  if (rows.length === 0) {
    console.log('Tab is empty.');
    return;
  }

  console.log('--- First 4 raw rows (to confirm header position) ---');
  rows.slice(0, 4).forEach((r, i) => console.log(`  [${i}] ${JSON.stringify(r)}`));

  const headers = rows[0].map((h) => (h || '').trim());
  const body = rows.slice(1);
  console.log(`\nHeaders: ${JSON.stringify(headers)}`);

  const dateCol = findColumn(headers, [/^date$/i, /date/i]);
  const catCol = findColumn(headers, [/categor/i, /^type$/i, /^source$/i]);
  const descCol = findColumn(headers, [/descr/i, /name/i, /item/i, /detail/i]);
  const amtCol = findColumn(headers, [/amount/i, /^cost$/i, /value/i, /price/i]);
  console.log(
    `Detected columns -> date:${dateCol} category:${catCol} desc:${descCol} amount:${amtCol}`
  );

  if (dateCol === -1) {
    console.error('\nCould not detect a date column; aborting filter. Inspect headers above.');
    return;
  }

  // Distinct categories across the whole tab (reveals the scheme + typos/rares).
  const catCounts = new Map<string, number>();
  if (catCol !== -1) {
    for (const r of body) {
      const c = (r[catCol] || '').trim();
      catCounts.set(c, (catCounts.get(c) || 0) + 1);
    }
    console.log('\n--- Categories used across whole tab (value: count) ---');
    [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([c, n]) => console.log(`  ${n.toString().padStart(4)}  ${c || '(blank)'}`));
  }

  const inRange = body
    .map((r, i) => ({ rowNumber: i + 2, cells: r, ym: toYearMonth(r[dateCol] || '') }))
    .filter((x) => x.ym && x.ym >= FROM && x.ym <= TO);

  console.log(`\n=== Rows in ${FROM}..${TO}: ${inRange.length} ===`);
  for (const x of inRange) {
    const desc = descCol !== -1 ? x.cells[descCol] : '';
    const amt = amtCol !== -1 ? x.cells[amtCol] : '';
    const cat = catCol !== -1 ? x.cells[catCol] : '';
    console.log(
      `  row ${x.rowNumber} | ${x.cells[dateCol]} | ${cat || '(blank)'} | ${amt} | ${desc}`
    );
  }

  // Baseline, schema-agnostic flags. Refine once the real category scheme is seen.
  const rareThreshold = 2;
  const incorrect: string[] = [];
  const possibly: string[] = [];
  const seen = new Map<string, number[]>();

  for (const x of inRange) {
    const cat = catCol !== -1 ? (x.cells[catCol] || '').trim() : '';
    const desc = descCol !== -1 ? (x.cells[descCol] || '').trim() : '';
    const amt = amtCol !== -1 ? (x.cells[amtCol] || '').trim() : '';

    if (catCol !== -1 && !cat) {
      incorrect.push(`row ${x.rowNumber}: blank category — ${desc} ${amt}`);
    } else if (catCol !== -1 && (catCounts.get(cat) || 0) <= rareThreshold) {
      possibly.push(
        `row ${x.rowNumber}: rare category "${cat}" (used ${catCounts.get(cat)}x) — ${desc} ${amt}`
      );
    }

    const dupKey = `${x.cells[dateCol]}|${amt}|${desc}`.toLowerCase();
    const arr = seen.get(dupKey) || [];
    arr.push(x.rowNumber);
    seen.set(dupKey, arr);
  }

  for (const [k, nums] of seen) {
    if (nums.length > 1) possibly.push(`rows ${nums.join(', ')}: possible duplicate — ${k}`);
  }

  console.log(`\n=== INCORRECT (${incorrect.length}) ===`);
  incorrect.forEach((l) => console.log('  ' + l));
  console.log(`\n=== POSSIBLY INCORRECT (${possibly.length}) ===`);
  possibly.forEach((l) => console.log('  ' + l));

  console.log('\nDone. (Baseline checks only — refine rules after reviewing the data above.)');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
