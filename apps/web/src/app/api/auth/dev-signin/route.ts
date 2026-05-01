/**
 * Dev-only programmatic sign-in route used by E2E tests.
 *
 * Mints a magic link via the Supabase admin API, verifies it, and uses the
 * SSR client to write the proper session cookie. Then redirects to /dashboard
 * so Playwright can capture the storageState.
 *
 * Disabled in production unless DEV_SIGNIN_TOKEN is set and matches the
 * `?token=` query parameter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const inProd = process.env.NODE_ENV === 'production';
  const expectedToken = process.env.DEV_SIGNIN_TOKEN;
  const providedToken = request.nextUrl.searchParams.get('token');
  const email = request.nextUrl.searchParams.get('email') ?? 'chris@hadleybricks.co.uk';

  if (inProd) {
    if (!expectedToken || providedToken !== expectedToken) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !sr) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const admin = createAdminClient(url, sr, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || !link.data?.properties) {
    return NextResponse.json(
      { error: `generateLink failed: ${link.error?.message}` },
      { status: 500 },
    );
  }
  const hashedToken = (link.data.properties as { hashed_token: string }).hashed_token;

  // Use the SSR client so setSession writes cookies via Next.js's cookie store
  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        for (const c of toSet) cookieStore.set(c.name, c.value, c.options);
      },
    },
  });

  const verify = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' });
  if (verify.error || !verify.data?.session) {
    return NextResponse.json(
      { error: `verifyOtp failed: ${verify.error?.message}` },
      { status: 500 },
    );
  }

  return NextResponse.redirect(new URL('/dashboard', request.url));
}
