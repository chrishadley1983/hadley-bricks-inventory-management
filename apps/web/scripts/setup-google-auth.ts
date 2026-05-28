/**
 * One-shot Google Sheets auth setup. Populates apps/web/.env.local with the
 * service-account credentials the Sheets scripts need, then verifies the
 * connection and confirms the "Monzo Transactions" tab is reachable.
 *
 * Usage:
 *   npx tsx scripts/setup-google-auth.ts path/to/service-account.json
 *   npx tsx scripts/setup-google-auth.ts                 # interactive / auto-detect
 *
 * Credential source resolution order:
 *   1. JSON key path given as the first arg or via GOOGLE_CREDENTIALS_PATH
 *   2. google-credentials.json next to this app (or repo root)
 *   3. GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY[_BASE64] already in env
 *   4. Interactive prompt for the JSON key path
 *
 * Tip: if you have the Vercel CLI linked, you can skip this entirely with:
 *   vercel env pull apps/web/.env.local
 */

import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { GoogleSheetsClient } from '../src/lib/google/sheets-client';

const ENV_PATH = resolve(__dirname, '../.env.local');
const DEFAULT_SHEET_ID = '1pmfxrFF4U08gXzsZOd49z4gbmmRHDrE_S8Vb6JqCMnU';

interface Creds {
  email: string;
  key: string;
}

function getFlag(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function loadFromJsonFile(path: string): Creds {
  const json = JSON.parse(readFileSync(path, 'utf-8'));
  if (!json.client_email || !json.private_key) {
    throw new Error(`"${path}" is missing client_email / private_key — is it a service-account key?`);
  }
  return { email: json.client_email, key: json.private_key };
}

function loadFromEnv(): Creds | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY_BASE64
    ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, 'base64').toString('utf-8')
    : process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (email && key) return { email, key };
  return null;
}

async function resolveCreds(): Promise<Creds> {
  const explicit = getFlag('--key-file') || (process.argv[2]?.startsWith('-') ? undefined : process.argv[2]);
  const candidates = [
    explicit,
    process.env.GOOGLE_CREDENTIALS_PATH,
    resolve(__dirname, '../google-credentials.json'),
    resolve(__dirname, '../../../google-credentials.json'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`Using service-account key file: ${p}`);
      return loadFromJsonFile(p);
    }
  }

  const fromEnv = loadFromEnv();
  if (fromEnv) {
    console.log('Using credentials already present in the environment.');
    return fromEnv;
  }

  if (!stdin.isTTY) {
    throw new Error(
      'No credentials found and not running interactively.\n' +
        'Pass the path to your service-account JSON key:\n' +
        '  npx tsx scripts/setup-google-auth.ts ./service-account.json'
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const path = (await rl.question('Path to service-account JSON key file: ')).trim();
    if (!path || !existsSync(path)) throw new Error(`File not found: ${path}`);
    return loadFromJsonFile(path);
  } finally {
    rl.close();
  }
}

function upsertEnv(path: string, kv: Record<string, string>): void {
  const lines = existsSync(path) ? readFileSync(path, 'utf-8').split('\n') : [];
  for (const [k, v] of Object.entries(kv)) {
    const idx = lines.findIndex((l) => l.startsWith(`${k}=`));
    const entry = `${k}=${v}`;
    if (idx !== -1) lines[idx] = entry;
    else lines.push(entry);
  }
  writeFileSync(path, lines.join('\n').replace(/\n+$/, '\n'), { mode: 0o600 });
}

async function main() {
  const { email, key } = await resolveCreds();

  if (!key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Private key does not look like a PEM block (missing "BEGIN PRIVATE KEY").');
  }

  const spreadsheetId = getFlag('--sheet-id') || process.env.GOOGLE_SHEETS_ID || DEFAULT_SHEET_ID;

  // Base64 avoids newline-mangling of the PEM across shells/CI.
  const keyB64 = Buffer.from(key, 'utf-8').toString('base64');
  upsertEnv(ENV_PATH, {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: email,
    GOOGLE_PRIVATE_KEY_BASE64: keyB64,
    GOOGLE_SHEETS_ID: spreadsheetId,
  });
  console.log(`\nWrote credentials to ${ENV_PATH}`);
  console.log(`  service account: ${email}`);
  console.log(`  private key:     ${key.length} chars (stored base64, ${keyB64.length} chars)`);
  console.log(`  spreadsheet id:  ${spreadsheetId}`);

  console.log('\nVerifying connection...');
  const client = new GoogleSheetsClient({ serviceAccountEmail: email, privateKey: key, spreadsheetId });
  const conn = await client.testConnection();
  if (!conn.success) {
    console.error(`\nConnection FAILED: ${conn.message}`);
    console.error(
      `\nMost likely the sheet isn't shared with the service account.\n` +
        `In Google Sheets: Share -> add "${email}" (Viewer is enough to read).`
    );
    process.exit(1);
  }
  console.log(`Connected to: ${conn.spreadsheetTitle}`);

  const sheets = await client.listSheets();
  const monzo = sheets.find((s) => /monzo/i.test(s.title));
  if (monzo) {
    console.log(`Found tab "${monzo.title}" (${monzo.rowCount} rows, ${monzo.columnCount} cols).`);
  } else {
    console.log('No tab matching /monzo/i found. Tabs available:');
    sheets.forEach((s) => console.log(`  - ${s.title}`));
  }

  console.log('\nDone. Next: npm run monzo:audit');
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
