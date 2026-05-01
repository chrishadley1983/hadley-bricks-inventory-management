/**
 * One-time OAuth flow to capture a refresh token for chris@hadleybricks.co.uk.
 *
 * Reuses the existing GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET (the
 * same Cloud project should authorise both accounts). Sets up a tiny localhost
 * callback server, opens an authorise URL, captures the code, exchanges it for
 * a refresh token, and prints the env line to add to .env.local + Vercel.
 *
 * Usage:
 *   npx tsx scripts/auth-hb-gmail.ts
 *
 * Then sign in as chris@hadleybricks.co.uk when the browser opens.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import { execSync } from 'child_process';

const PORT = 53931;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth/callback`;
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET in .env.local');
  console.error('These are needed even for the second account — same Cloud project.');
  console.error('');
  console.error('Note: the OAuth client must allow this redirect URI:');
  console.error(`  ${REDIRECT_URI}`);
  console.error('Add it under https://console.cloud.google.com/apis/credentials → your client → Authorised redirect URIs');
  process.exit(1);
}

(async () => {
  const oauth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const url = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token issuance
    scope: SCOPES,
    login_hint: 'chris@hadleybricks.co.uk',
  });

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
        if (reqUrl.pathname !== '/oauth/callback') {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        const c = reqUrl.searchParams.get('code');
        const e = reqUrl.searchParams.get('error');
        if (e) {
          res.end(`Auth error: ${e}. You can close this tab.`);
          server.close();
          reject(new Error(e));
          return;
        }
        if (!c) {
          res.end('No code received.');
          server.close();
          reject(new Error('no code'));
          return;
        }
        res.end('OAuth complete. You can close this tab and return to the terminal.');
        server.close();
        resolve(c);
      } catch (err) {
        reject(err as Error);
      }
    });
    server.listen(PORT, () => {
      console.log(`\nVisit this URL in your browser (sign in as chris@hadleybricks.co.uk):\n\n${url}\n`);
      // Best-effort browser open
      try {
        execSync(`start "" "${url}"`, { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    });
    server.on('error', reject);
  });

  const tokenResp = await oauth.getToken(code);
  const refresh = tokenResp.tokens.refresh_token;
  if (!refresh) {
    console.error('No refresh_token returned. Try revoking the existing grant at https://myaccount.google.com/permissions and re-running.');
    process.exit(1);
  }

  // Verify by fetching profile
  oauth.setCredentials(tokenResp.tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth });
  const profile = await gmail.users.getProfile({ userId: 'me' });

  console.log('\n✓ Got refresh token for', profile.data.emailAddress);
  console.log('\nAdd this to apps/web/.env.local AND your Vercel env (Production + Preview):');
  console.log('');
  console.log(`GOOGLE_GMAIL_HB_REFRESH_TOKEN=${refresh}`);
  console.log('');
  console.log('No need to set GOOGLE_GMAIL_HB_CLIENT_ID/SECRET — the adapter falls back to the primary client.');
})();
