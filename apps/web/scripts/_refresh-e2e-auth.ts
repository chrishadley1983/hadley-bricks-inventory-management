/**
 * Refresh the Playwright E2E auth storage state by signing in programmatically
 * via the Supabase admin API. Avoids needing manual login.
 *
 * Uses admin.generateLink to mint a magic-link token, then exchanges that token
 * for a real session via /auth/v1/verify, then writes the session cookies to
 * `.playwright/.auth/user.json` in the format Playwright expects.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_EMAIL = process.argv[2] ?? 'chrishadley1983@gmail.com';
const PORT = process.argv[3] ?? '3002';

if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

(async () => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SR, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Mint a magic link for the user
  const linkResp = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_EMAIL,
    options: {
      redirectTo: `http://localhost:${PORT}/auth/callback`,
    },
  });

  if (linkResp.error || !linkResp.data?.properties) {
    console.error('Failed to generate magic link:', linkResp.error);
    process.exit(1);
  }

  const { hashed_token } = linkResp.data.properties as { hashed_token: string };
  console.log('[e2e-auth] generated magiclink token');

  // Exchange the hashed token for a session via verifyOtp
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verify = await anon.auth.verifyOtp({
    token_hash: hashed_token,
    type: 'magiclink',
  });
  if (verify.error || !verify.data?.session) {
    console.error('Failed to verify token:', verify.error);
    process.exit(1);
  }

  const session = verify.data.session;
  console.log('[e2e-auth] obtained session, expires at:', new Date(session.expires_at! * 1000).toISOString());

  // Write the storage state file in Playwright format
  const cookieDomain = 'localhost';
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue =
    'base64-' +
    Buffer.from(
      JSON.stringify({
        access_token: session.access_token,
        token_type: 'bearer',
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        refresh_token: session.refresh_token,
        user: session.user,
      }),
    ).toString('base64');

  const storageState = {
    cookies: [
      {
        name: cookieName,
        value: cookieValue,
        domain: cookieDomain,
        path: '/',
        expires: session.expires_at ?? -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  const target = path.resolve(__dirname, '../.playwright/.auth/user.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(storageState, null, 2));
  console.log('[e2e-auth] wrote', target);
})();
