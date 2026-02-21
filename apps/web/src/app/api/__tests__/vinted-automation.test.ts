/**
 * API Functional Tests for Vinted Automation Endpoints
 *
 * Tests AUTH1-AUTH4, CFG1-CFG3, HB1-HB5, PROC1-PROC4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  ScanResultSchema,
  ProcessRequestSchema,
  HeartbeatRequestSchema,
} from '@/types/vinted-automation';

// Mock Supabase
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

const mockSupabase = {
  from: vi.fn(),
};

// Import after mocking
import { GET as getConfig } from '../arbitrage/vinted/automation/config/route';
import { POST as postHeartbeat } from '../arbitrage/vinted/automation/heartbeat/route';
import { POST as postProcess } from '../arbitrage/vinted/automation/process/route';

// Test fixtures
const validApiKey = 'test-api-key-123';
const testUserId = 'user-abc-123';

const mockConfigData = {
  enabled: true,
  paused: false,
  pause_reason: null,
  broad_sweep_cog_threshold: 50,
  watchlist_cog_threshold: 60,
  near_miss_threshold: 75,
  operating_hours_start: '08:00',
  operating_hours_end: '22:00',
  config_version: 3,
  schedule_version: 5,
};

describe('Vinted Automation API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('API Key Authentication (AUTH1-AUTH4)', () => {
    beforeEach(() => {
      // Setup API key validation mock
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              if (col === 'api_key' && val === validApiKey) {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: { user_id: testUserId, api_key: validApiKey, ...mockConfigData },
                    error: null,
                  }),
                };
              }
              if (col === 'user_id') {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: mockConfigData,
                    error: null,
                  }),
                };
              }
              return {
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
              };
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });
    });

    // AUTH1: All /automation/* endpoints validate X-Api-Key header
    it('should require X-Api-Key header', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/config'
      );

      const response = await getConfig(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toContain('X-Api-Key');
    });

    // AUTH4: Invalid API key returns 401
    it('should return 401 for invalid API key', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/config',
        {
          headers: { 'X-Api-Key': 'invalid-key' },
        }
      );

      const response = await getConfig(request);

      expect(response.status).toBe(401);
    });

    it('should accept valid API key', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/config',
        {
          headers: { 'X-Api-Key': validApiKey },
        }
      );

      const response = await getConfig(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Config API (CFG1-CFG3)', () => {
    beforeEach(() => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              if (col === 'api_key' && val === validApiKey) {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: { user_id: testUserId, api_key: validApiKey },
                    error: null,
                  }),
                };
              }
              if (col === 'user_id') {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: mockConfigData,
                    error: null,
                  }),
                };
              }
              return {
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        return null;
      });
    });

    // CFG1: Returns scanner configuration
    it('should return scanner configuration', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/config',
        {
          headers: { 'X-Api-Key': validApiKey },
        }
      );

      const response = await getConfig(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        enabled: true,
        paused: false,
        broadSweepCogThreshold: 50,
        watchlistCogThreshold: 60,
        nearMissThreshold: 75,
        operatingHoursStart: '08:00',
        operatingHoursEnd: '22:00',
      });
    });

    // CFG2: Returns config version
    it('should include config version', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/config',
        {
          headers: { 'X-Api-Key': validApiKey },
        }
      );

      const response = await getConfig(request);
      const body = await response.json();

      expect(body.configVersion).toBe(3);
    });

    // CFG3: Returns schedule version
    it('should include schedule version', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/config',
        {
          headers: { 'X-Api-Key': validApiKey },
        }
      );

      const response = await getConfig(request);
      const body = await response.json();

      expect(body.scheduleVersion).toBe(5);
    });
  });

  describe('Heartbeat API (HB1-HB5)', () => {
    beforeEach(() => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              if (col === 'api_key' && val === validApiKey) {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: { user_id: testUserId, api_key: validApiKey },
                    error: null,
                  }),
                };
              }
              if (col === 'user_id') {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: { config_version: 3, schedule_version: 5 },
                    error: null,
                  }),
                };
              }
              return {
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        return null;
      });
    });

    // HB1: Accepts heartbeat POST
    it('should accept heartbeat request', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/heartbeat',
        {
          method: 'POST',
          headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            machineId: 'DESKTOP-ABC123',
            status: 'running',
            scansToday: 10,
            opportunitiesToday: 2,
          }),
        }
      );

      const response = await postHeartbeat(request);

      expect(response.status).toBe(200);
    });

    // HB2: Returns current versions
    it('should return current config and schedule versions', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/heartbeat',
        {
          method: 'POST',
          headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            machineId: 'DESKTOP-ABC123',
            status: 'running',
            scansToday: 0,
            opportunitiesToday: 0,
          }),
        }
      );

      const response = await postHeartbeat(request);
      const body = await response.json();

      expect(body.configVersion).toBe(3);
      expect(body.scheduleVersion).toBe(5);
    });

    // HB3: Validates heartbeat schema
    it('should reject invalid heartbeat data', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/heartbeat',
        {
          method: 'POST',
          headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Missing required fields
            status: 'invalid-status',
          }),
        }
      );

      const response = await postHeartbeat(request);

      expect(response.status).toBe(400);
    });

    // HB4: Accepts valid status values
    it.each(['running', 'paused', 'error', 'outside_hours'])(
      'should accept status "%s"',
      async (status) => {
        const request = new NextRequest(
          'http://localhost:3000/api/arbitrage/vinted/automation/heartbeat',
          {
            method: 'POST',
            headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              machineId: 'DESKTOP-ABC123',
              status,
              scansToday: 0,
              opportunitiesToday: 0,
            }),
          }
        );

        const response = await postHeartbeat(request);

        expect(response.status).toBe(200);
      }
    );
  });

  describe('Process API (PROC1-PROC4)', () => {
    beforeEach(() => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              if (col === 'api_key' && val === validApiKey) {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: { user_id: testUserId, api_key: validApiKey },
                    error: null,
                  }),
                };
              }
              return {
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'vinted_scan_history') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'vinted_opportunities') {
          return {
            upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return null;
      });
    });

    // PROC1: Validates request body with Zod
    it('should validate process request body', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/process',
        {
          method: 'POST',
          headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Invalid - missing required fields
            scanType: 'invalid',
          }),
        }
      );

      const response = await postProcess(request);

      expect(response.status).toBe(400);
    });

    // PROC2: Accepts valid scan result
    it('should accept valid scan result', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/process',
        {
          method: 'POST',
          headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scanId: 'bs-2026-01-21-08',
            scanType: 'broad_sweep',
            result: {
              success: true,
              captchaDetected: false,
              listings: [],
              pagesScanned: 5,
            },
          }),
        }
      );

      const response = await postProcess(request);

      expect(response.status).toBe(200);
    });

    // PROC3: Accepts scan with listings
    it('should process scan with listings', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/process',
        {
          method: 'POST',
          headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scanId: 'wl-2026-01-21-001',
            scanType: 'watchlist',
            setNumber: '75192',
            result: {
              success: true,
              captchaDetected: false,
              listings: [
                {
                  url: 'https://www.vinted.co.uk/items/12345',
                  title: 'LEGO 75192 Millennium Falcon',
                  price: 450.0,
                  currency: 'GBP',
                  sellerName: 'testuser',
                  sellerRating: 4.8,
                  listedAt: new Date().toISOString(),
                  imageUrl: 'https://images.vinted.net/12345.jpg',
                },
              ],
              pagesScanned: 3,
            },
          }),
        }
      );

      const response = await postProcess(request);

      expect(response.status).toBe(200);
    });

    // PROC4: Handles CAPTCHA detection
    it('should handle CAPTCHA detected result', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/arbitrage/vinted/automation/process',
        {
          method: 'POST',
          headers: { 'X-Api-Key': validApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scanId: 'bs-2026-01-21-10',
            scanType: 'broad_sweep',
            result: {
              success: false,
              captchaDetected: true,
              listings: [],
              pagesScanned: 0,
              error: 'CAPTCHA detected',
            },
          }),
        }
      );

      const response = await postProcess(request);

      expect(response.status).toBe(200);
    });
  });
});

describe('Zod Schema Validation', () => {
  describe('ScanResultSchema', () => {
    it('should accept valid scan result', () => {
      const result = ScanResultSchema.safeParse({
        success: true,
        captchaDetected: false,
        listings: [],
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

    it('should validate listing structure', () => {
      const result = ScanResultSchema.safeParse({
        success: true,
        listings: [
          {
            url: 'https://vinted.co.uk/items/123',
            title: 'LEGO Set',
            price: 100,
            currency: 'GBP',
          },
        ],
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid listing', () => {
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

  describe('ProcessRequestSchema', () => {
    it('should accept valid process request', () => {
      const result = ProcessRequestSchema.safeParse({
        scanId: 'bs-2026-01-21-08',
        scanType: 'broad_sweep',
        result: {
          success: true,
        },
      });

      expect(result.success).toBe(true);
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

    it('should allow optional setNumber for watchlist scans', () => {
      const result = ProcessRequestSchema.safeParse({
        scanId: 'wl-2026-01-21-001',
        scanType: 'watchlist',
        setNumber: '75192',
        result: { success: true },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.setNumber).toBe('75192');
      }
    });
  });

  describe('HeartbeatRequestSchema', () => {
    it('should accept valid heartbeat', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'running',
        scansToday: 10,
        opportunitiesToday: 2,
      });

      expect(result.success).toBe(true);
    });

    it('should validate status enum', () => {
      const validStatuses = ['running', 'paused', 'error', 'outside_hours'];

      validStatuses.forEach((status) => {
        const result = HeartbeatRequestSchema.safeParse({
          machineId: 'DESKTOP-ABC123',
          status,
          scansToday: 0,
          opportunitiesToday: 0,
        });
        expect(result.success).toBe(true);
      });

      const invalid = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'invalid',
        scansToday: 0,
        opportunitiesToday: 0,
      });
      expect(invalid.success).toBe(false);
    });

    it('should require numeric counts', () => {
      const result = HeartbeatRequestSchema.safeParse({
        machineId: 'DESKTOP-ABC123',
        status: 'running',
        scansToday: 'ten',
        opportunitiesToday: 2,
      });

      expect(result.success).toBe(false);
    });
  });
});
