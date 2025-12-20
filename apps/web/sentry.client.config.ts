import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1.0,

  // Set to lower value in production
  replaysSessionSampleRate: 0.1,

  // If you're not already sampling the entire session, change this to 100% when
  // sampling sessions where errors occur.
  replaysOnErrorSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',

  // Configure release and environment
  environment: process.env.NODE_ENV,
});
