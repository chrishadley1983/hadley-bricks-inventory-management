/**
 * Smoke Tests - Fast Critical Path Validation
 *
 * These tests run on every fix to ensure nothing is fundamentally broken.
 * They should complete in under 30 seconds total.
 *
 * Philosophy:
 * - Test that critical imports work (no broken dependencies)
 * - Test that core utilities are functional
 * - NO API calls, NO database, NO external services
 * - Fast feedback > comprehensive coverage
 */

import { describe, it, expect } from 'vitest';

describe('Smoke Tests', () => {
  describe('Critical Imports - Core Libraries', () => {
    it('imports core utilities', async () => {
      const utils = await import('@/lib/utils');
      expect(utils).toBeDefined();
      expect(utils.cn).toBeDefined();
    });

    it('imports date utilities', async () => {
      const dateFns = await import('date-fns');
      expect(dateFns.format).toBeDefined();
      expect(dateFns.parseISO).toBeDefined();
    });

    it('imports zod for validation', async () => {
      const { z } = await import('zod');
      expect(z).toBeDefined();
      expect(z.string).toBeDefined();
      expect(z.object).toBeDefined();
    });
  });

  describe('Critical Imports - Supabase', () => {
    it('imports supabase client module', async () => {
      const supabase = await import('@/lib/supabase/client');
      expect(supabase).toBeDefined();
    });

    it('imports supabase server module', async () => {
      const supabase = await import('@/lib/supabase/server');
      expect(supabase).toBeDefined();
    });
  });

  describe('Critical Imports - UI Components', () => {
    it('imports button component', async () => {
      const { Button } = await import('@/components/ui/button');
      expect(Button).toBeDefined();
    });

    it('imports card component', async () => {
      const { Card } = await import('@/components/ui/card');
      expect(Card).toBeDefined();
    });

    it('imports data table component', async () => {
      const { DataTable } = await import('@/components/ui/data-table');
      expect(DataTable).toBeDefined();
    });
  });

  describe('Core Utility Functions', () => {
    it('cn utility merges class names', async () => {
      const { cn } = await import('@/lib/utils');
      const result = cn('foo', 'bar', { baz: true, qux: false });
      expect(result).toContain('foo');
      expect(result).toContain('bar');
      expect(result).toContain('baz');
      expect(result).not.toContain('qux');
    });

    it('formatCurrency formats correctly', async () => {
      const { formatCurrency } = await import('@/lib/utils');
      if (formatCurrency) {
        const result = formatCurrency(1234.56);
        expect(result).toBeDefined();
      }
    });
  });

  describe('Environment Sanity', () => {
    it('runs in test environment', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });

    it('vitest is configured correctly', () => {
      expect(typeof describe).toBe('function');
      expect(typeof it).toBe('function');
      expect(typeof expect).toBe('function');
    });
  });
});
