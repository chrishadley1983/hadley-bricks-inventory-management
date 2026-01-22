/**
 * Tests for Vinted Automation Zod Schemas
 *
 * Tests CLI5-CLI6, PROC1-PROC4, HB1-HB5 schema validation
 */

import { describe, it, expect } from 'vitest';
import {
  ScanResultSchema,
  ProcessRequestSchema,
  HeartbeatRequestSchema,
  ListingSchema,
} from '../vinted-automation';

describe('Vinted Automation Zod Schemas', () => {
  describe('ListingSchema', () => {
    it('should accept valid listing with all fields', () => {
      const result = ListingSchema.safeParse({
        title: 'LEGO 75192 Millennium Falcon',
        price: 450,
        currency: 'GBP',
        url: 'https://www.vinted.co.uk/items/12345',
        vintedListingId: '12345',
        listedAt: '2026-01-21T10:00:00Z',
        imageUrl: 'https://images.vinted.net/12345.jpg',
      });

      expect(result.success).toBe(true);
    });

    it('should accept listing with only required fields', () => {
      const result = ListingSchema.safeParse({
        title: 'LEGO Set',
        price: 100,
        url: 'https://www.vinted.co.uk/items/123',
        vintedListingId: '123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe('GBP'); // Default
      }
    });

    it('should reject listing without required fields', () => {
      const result = ListingSchema.safeParse({
        title: 'LEGO Set',
        price: 100,
        // missing url and vintedListingId
      });

      expect(result.success).toBe(false);
    });

    it('should reject invalid URL', () => {
      const result = ListingSchema.safeParse({
        title: 'LEGO Set',
        price: 100,
        url: 'not-a-valid-url',
        vintedListingId: '123',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ScanResultSchema (CLI5-CLI6)', () => {
    it('should accept valid scan result with listings', () => {
      const result = ScanResultSchema.safeParse({
        success: true,
        captchaDetected: false,
        listings: [
          {
            title: 'LEGO 75192',
            price: 450,
            url: 'https://www.vinted.co.uk/items/12345',
            vintedListingId: '12345',
          },
        ],
        pagesScanned: 5,
      });

      expect(result.success).toBe(true);
    });

    it('should provide defaults for optional fields', () => {
      const result = ScanResultSchema.safeParse({
        success: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.captchaDetected).toBe(false);
        expect(result.data.listings).toEqual([]);
        expect(result.data.pagesScanned).toBe(0);
      }
    });

    it('should accept failed scan with error message', () => {
      const result = ScanResultSchema.safeParse({
        success: false,
        captchaDetected: true,
        error: 'CAPTCHA detected on page',
        pagesScanned: 0,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error).toBe('CAPTCHA detected on page');
      }
    });

    it('should accept timing delay', () => {
      const result = ScanResultSchema.safeParse({
        success: true,
        timingDelayMs: 2500,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timingDelayMs).toBe(2500);
      }
    });

    it('should reject invalid listing in array', () => {
      const result = ScanResultSchema.safeParse({
        success: true,
        listings: [
          {
            // Missing required fields
            price: 'not-a-number',
          },
        ],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ProcessRequestSchema (PROC1-PROC4)', () => {
    it('should accept valid broad sweep request', () => {
      const result = ProcessRequestSchema.safeParse({
        scanId: 'bs-2026-01-21-08',
        scanType: 'broad_sweep',
        result: {
          success: true,
          listings: [],
          pagesScanned: 5,
        },
      });

      expect(result.success).toBe(true);
    });

    it('should accept valid watchlist request with setNumber', () => {
      const result = ProcessRequestSchema.safeParse({
        scanId: 'wl-2026-01-21-001',
        scanType: 'watchlist',
        setNumber: '75192',
        result: {
          success: true,
          listings: [],
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.setNumber).toBe('75192');
      }
    });

    it('should require scanId', () => {
      const result = ProcessRequestSchema.safeParse({
        scanType: 'broad_sweep',
        result: { success: true },
      });

      expect(result.success).toBe(false);
    });

    it('should validate scanType enum', () => {
      const result = ProcessRequestSchema.safeParse({
        scanId: 'test',
        scanType: 'invalid_type',
        result: { success: true },
      });

      expect(result.success).toBe(false);
    });

    it('should accept both valid scan types', () => {
      const broadSweep = ProcessRequestSchema.safeParse({
        scanId: 'bs-test',
        scanType: 'broad_sweep',
        result: { success: true },
      });

      const watchlist = ProcessRequestSchema.safeParse({
        scanId: 'wl-test',
        scanType: 'watchlist',
        result: { success: true },
      });

      expect(broadSweep.success).toBe(true);
      expect(watchlist.success).toBe(true);
    });

    it('should require nested result object', () => {
      const result = ProcessRequestSchema.safeParse({
        scanId: 'test',
        scanType: 'broad_sweep',
        // missing result
      });

      expect(result.success).toBe(false);
    });

    it('should accept explicit null for setNumber on broad_sweep', () => {
      const result = ProcessRequestSchema.safeParse({
        scanId: 'bs-test',
        scanType: 'broad_sweep',
        setNumber: null,
        result: { success: true },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('HeartbeatRequestSchema (HB1-HB5)', () => {
    it('should accept valid heartbeat with all fields', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        machineName: 'Chris Home PC',
        status: 'running',
        lastScanAt: '2026-01-21T10:00:00Z',
        scansToday: 10,
        opportunitiesToday: 2,
      });

      expect(result.success).toBe(true);
    });

    it('should accept heartbeat with only required fields', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'running',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scansToday).toBe(0); // Default
        expect(result.data.opportunitiesToday).toBe(0); // Default
      }
    });

    it('should validate status enum - running', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'running',
      });
      expect(result.success).toBe(true);
    });

    it('should validate status enum - paused', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'paused',
      });
      expect(result.success).toBe(true);
    });

    it('should validate status enum - error', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'error',
        errorMessage: 'Connection timeout',
      });
      expect(result.success).toBe(true);
    });

    it('should validate status enum - outside_hours', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'outside_hours',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'sleeping',
      });
      expect(result.success).toBe(false);
    });

    it('should require machineId', () => {
      const result = HeartbeatRequestSchema.safeParse({
        status: 'running',
        scansToday: 5,
      });
      expect(result.success).toBe(false);
    });

    it('should require numeric counts', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'running',
        scansToday: 'ten',
      });
      expect(result.success).toBe(false);
    });
  });
});
