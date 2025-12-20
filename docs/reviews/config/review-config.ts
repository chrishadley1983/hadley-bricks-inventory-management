/**
 * Hadley Bricks - Code Review Configuration
 */

export const reviewConfig = {
  strictness: 'moderate' as const,

  enabledCategories: [
    'correctness',
    'security',
    'performance',
    'maintainability',
    'dry',
    'architecture',
    'standards',
    'testing',
  ] as const,

  criticalPaths: [
    'app/api/**',
    'lib/adapters/**',
    'lib/repositories/**',
    'lib/services/**',
    'lib/sync/**',
    'lib/google/**',
    'supabase/migrations/**',
  ],

  relaxedPaths: ['scripts/**', 'tools/**', 'docs/**'],

  // Code quality thresholds
  minCoverageNew: 80,
  maxComplexity: 15,
  maxFunctionLength: 50,
  maxFileLength: 500,

  // Hadley Bricks specific checks
  hadleyBricksChecks: {
    platformCredentials: {
      description: 'Platform credentials encrypted at rest?',
      severity: 'critical',
      applies: ['lib/adapters/**', 'app/api/**/credentials/**'],
    },
    adapterPattern: {
      description: 'Following PlatformAdapter interface?',
      severity: 'major',
      applies: ['lib/adapters/**'],
    },
    repositoryPattern: {
      description: 'Using repository layer for data access?',
      severity: 'major',
      applies: ['lib/services/**', 'app/api/**'],
    },
    dualWrite: {
      description: 'Sheets + Supabase both updated?',
      severity: 'critical',
      applies: ['lib/repositories/**'],
    },
    rlsPolicies: {
      description: 'RLS policies defined for new tables?',
      severity: 'critical',
      applies: ['supabase/migrations/**'],
    },
    cacheInvalidation: {
      description: 'Cache invalidated after writes?',
      severity: 'major',
      applies: ['lib/repositories/**', 'lib/sync/**'],
    },
  },

  // Severity definitions
  severityLevels: {
    critical: {
      blocksMerge: true,
      description: 'Security issues, data loss risks, breaking bugs',
    },
    major: {
      blocksMerge: true,
      description: 'Logic errors, missing validation, pattern violations',
    },
    minor: {
      blocksMerge: false,
      description: 'Style issues, missing docs, small improvements',
    },
    nitpick: {
      blocksMerge: false,
      description: 'Preferences, optional improvements',
    },
  },

  // Files to always review carefully
  sensitiveFiles: [
    '.env*',
    '**/credentials*',
    '**/auth*',
    '**/encrypt*',
    'supabase/migrations/**',
  ],

  // Patterns that should trigger security review
  securityPatterns: [
    /password/i,
    /secret/i,
    /api_key/i,
    /token/i,
    /credential/i,
    /eval\(/,
    /innerHTML/,
    /dangerouslySetInnerHTML/,
  ],
};

export type ReviewCategory = (typeof reviewConfig.enabledCategories)[number];
export type Severity = keyof typeof reviewConfig.severityLevels;
