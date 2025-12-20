/**
 * Hadley Bricks - Test Configuration
 * Defines features, priorities, and coverage targets
 */

export const projectConfig = {
  name: 'Hadley Bricks',

  features: {
    // Core Features (CRITICAL Priority)
    auth: { priority: 'CRITICAL', module: 'auth' },
    inventory: { priority: 'CRITICAL', module: 'inventory' },
    purchases: { priority: 'CRITICAL', module: 'purchases' },
    orders: { priority: 'CRITICAL', module: 'orders' },

    // Platform Integrations (HIGH Priority)
    bricklink: { priority: 'HIGH', module: 'adapters/bricklink' },
    brickowl: { priority: 'HIGH', module: 'adapters/brickowl' },
    bricqer: { priority: 'HIGH', module: 'adapters/bricqer' },

    // Data Layer (HIGH Priority)
    sheetsSync: { priority: 'HIGH', module: 'google' },
    repositories: { priority: 'HIGH', module: 'repositories' },
    dualWrite: { priority: 'HIGH', module: 'sync' },
    cache: { priority: 'HIGH', module: 'sync/cache' },

    // Reporting (MEDIUM Priority)
    financials: { priority: 'MEDIUM', module: 'reports' },
    dashboard: { priority: 'MEDIUM', module: 'dashboard' },
  },

  coverageTargets: {
    overall: { branches: 70, functions: 80, lines: 80, statements: 80 },
    critical: { branches: 80, functions: 85, lines: 85, statements: 85 },
    high: { branches: 70, functions: 75, lines: 75, statements: 75 },
    medium: { branches: 60, functions: 70, lines: 70, statements: 70 },
  },

  criticalPaths: [
    'app/api/**',
    'lib/adapters/**',
    'lib/repositories/**',
    'lib/services/**',
    'lib/sync/**',
    'lib/google/**',
    'supabase/migrations/**',
  ],

  testTypes: ['unit', 'api', 'integration', 'e2e'] as const,

  testLocations: {
    unit: 'tests/unit/',
    api: 'tests/api/',
    integration: 'tests/integration/',
    e2e: 'tests/e2e/playwright/',
    fixtures: 'tests/fixtures/',
  },

  // Hadley Bricks specific test considerations
  platformAdapters: ['bricklink', 'brickowl', 'bricqer'],

  dualWriteEntities: ['inventory', 'purchases', 'orders'],

  // Test timeout configurations
  timeouts: {
    unit: 5000,
    api: 10000,
    integration: 30000,
    e2e: 60000,
  },
};

export type Feature = keyof typeof projectConfig.features;
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TestType = (typeof projectConfig.testTypes)[number];
