export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    await import('../sentry.server.config');
  }

  // Edge instrumentation disabled — @sentry/nextjs uses eval() which is
  // disallowed in the edge runtime. Re-enable when Sentry fixes this.
}
