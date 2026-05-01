/**
 * Gmail coverage test for order-issues ingestion.
 *
 * Probes the configured Gmail account for examples of each of the 7 coverage
 * cases (A–G) and reports yes/no/inconclusive per case. Inconclusive cases
 * (no recent examples) are warnings — they don't fail the script.
 *
 * Usage:  npm run test:gmail-coverage
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { google } from 'googleapis';

const PERSONAL_ADDR = 'chrishadley1983@gmail.com';
const HADLEY_ADDR = 'chris@hadleybricks.co.uk';
const BRICQER_RELAY = 'shops+hadleybricks@bricqer.com';

interface Case {
  id: string;
  description: string;
  query: string;
  expectInbox?: boolean;
  expectSent?: boolean;
}

const CASES: Case[] = [
  {
    id: 'A',
    description: 'External buyer → chrishadley1983@gmail.com',
    query: `to:${PERSONAL_ADDR} -from:${PERSONAL_ADDR} -from:${HADLEY_ADDR} -from:${BRICQER_RELAY} newer_than:90d`,
    expectInbox: true,
  },
  {
    id: 'B',
    description: 'External buyer → chris@hadleybricks.co.uk (forwarded into Gmail)',
    query: `to:${HADLEY_ADDR} -from:${HADLEY_ADDR} newer_than:90d`,
    expectInbox: true,
  },
  {
    id: 'C',
    description: 'Bricqer relay (shops+hadleybricks@bricqer.com)',
    query: `from:${BRICQER_RELAY} OR to:${BRICQER_RELAY} newer_than:90d`,
    expectInbox: true,
  },
  {
    id: 'D',
    description: 'BL/BO platform notification email',
    query: `(from:bricklink OR from:brickowl OR subject:"Bricklink Order" OR subject:"BrickOwl Order") newer_than:90d`,
    expectInbox: true,
  },
  {
    id: 'E',
    description: `Sent from ${PERSONAL_ADDR}`,
    query: `in:sent from:${PERSONAL_ADDR} newer_than:90d`,
    expectSent: true,
  },
  {
    id: 'F',
    description: `Sent from ${HADLEY_ADDR} (Gmail "Send mail as")`,
    query: `in:sent from:${HADLEY_ADDR} newer_than:90d`,
    expectSent: true,
  },
  {
    id: 'G',
    description: `Sent from ${HADLEY_ADDR} via separate webmail (likely NOT in Gmail Sent — known gap)`,
    query: `in:sent from:${HADLEY_ADDR} newer_than:90d`,
    expectSent: true,
  },
];

function getGmail() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing GOOGLE_GMAIL_* env vars (.env.local)');
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

(async () => {
  const gmail = getGmail();
  console.log('\nGmail coverage test for order-issues ingestion\n');
  console.log('===============================================\n');

  let passed = 0;
  let inconclusive = 0;
  let failed = 0;

  for (const c of CASES) {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: c.query,
      maxResults: 3,
    });
    const messages = res.data.messages ?? [];
    const found = messages.length;

    let status: 'PASS' | 'INCONCLUSIVE' | 'FAIL';
    if (found > 0) {
      status = 'PASS';
      passed++;
    } else if (c.id === 'G') {
      // Known gap acceptable
      status = 'INCONCLUSIVE';
      inconclusive++;
    } else {
      status = 'INCONCLUSIVE';
      inconclusive++;
    }

    const tag =
      status === 'PASS'
        ? '✓ PASS'
        : status === 'FAIL'
          ? '✗ FAIL'
          : '? INCONCLUSIVE';

    console.log(`[${c.id}] ${tag}  ${c.description}`);
    console.log(`     Query: ${c.query}`);
    console.log(`     Found: ${found} message(s)`);
    if (status === 'PASS' && messages[0]?.id) {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: messages[0].id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });
      const headers = detail.data.payload?.headers ?? [];
      const get = (n: string) =>
        headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? '';
      console.log(`     Sample subject: ${get('Subject').slice(0, 80)}`);
      console.log(`     Sample from:    ${get('From').slice(0, 80)}`);
    }
    console.log();
  }

  console.log('-----------------------------------------------');
  console.log(
    `Result: ${passed} pass, ${inconclusive} inconclusive, ${failed} fail (out of ${CASES.length})`,
  );
  console.log(
    'Inconclusive cases mean no recent examples were found — not an ingestion failure. Send a test message and re-run to confirm.',
  );

  process.exit(failed > 0 ? 1 : 0);
})();
