/**
 * Tests for Vinted Schedule Service
 *
 * Tests SCHED1-SCHED10: Server-side schedule generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VintedScheduleService, type ScheduleResponse } from '../vinted-schedule.service';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
};

// Mock responses
const mockConfig = {
  operating_hours_start: '08:00',
  operating_hours_end: '22:00',
  schedule_version: 5,
};

const mockWatchlist = [
  { set_number: '75192', asin: 'B075SDMMMV', source: 'best_seller' },
  { set_number: '10300', asin: 'B09R4PMQH5', source: 'popular_retired' },
  { set_number: '75375', asin: null, source: 'best_seller' },
];

describe('VintedScheduleService', () => {
  let service: VintedScheduleService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock responses
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'vinted_scanner_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockConfig, error: null }),
        };
      }
      if (table === 'vinted_watchlist') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: mockWatchlist, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    service = new VintedScheduleService(mockSupabase as never);
  });

  describe('generateSchedule', () => {
    // SCHED1: GET /api/arbitrage/vinted/automation/schedule returns schedule
    it('should generate a schedule with date and scans', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));

      expect(schedule).toMatchObject({
        date: '2026-01-21',
        scheduleVersion: 5,
        operatingHours: {
          start: '08:00',
          end: '22:00',
        },
      });
      expect(schedule.scans).toBeDefined();
      expect(Array.isArray(schedule.scans)).toBe(true);
    });

    // SCHED2-SCHED3: Reproducible with seeded random
    it('should produce identical schedule for same date and user', async () => {
      const date = new Date('2026-01-21');

      const schedule1 = await service.generateSchedule('user-123', date);
      const schedule2 = await service.generateSchedule('user-123', date);

      expect(schedule1.scans.map((s) => s.scheduledTime)).toEqual(
        schedule2.scans.map((s) => s.scheduledTime)
      );
    });

    it('should produce different schedule for different dates', async () => {
      const schedule1 = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const schedule2 = await service.generateSchedule('user-123', new Date('2026-01-22'));

      // At least some times should differ (broad sweeps have random minute)
      const times1 = schedule1.scans.map((s) => s.scheduledTime);
      const times2 = schedule2.scans.map((s) => s.scheduledTime);

      expect(times1).not.toEqual(times2);
    });

    it('should produce different schedule for different users', async () => {
      const date = new Date('2026-01-21');

      const schedule1 = await service.generateSchedule('user-123', date);
      const schedule2 = await service.generateSchedule('user-456', date);

      const times1 = schedule1.scans.map((s) => s.scheduledTime);
      const times2 = schedule2.scans.map((s) => s.scheduledTime);

      expect(times1).not.toEqual(times2);
    });

    // SCHED4: Broad sweeps every hour
    it('should generate one broad sweep per operating hour', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const broadSweeps = schedule.scans.filter((s) => s.type === 'broad_sweep');

      // 08:00 to 22:00 = 14 hours
      expect(broadSweeps.length).toBe(14);
    });

    it('should schedule broad sweeps at different hours', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const broadSweeps = schedule.scans.filter((s) => s.type === 'broad_sweep');

      const hours = broadSweeps.map((s) => parseInt(s.scheduledTime.split(':')[0]));
      const uniqueHours = new Set(hours);

      expect(uniqueHours.size).toBe(14);
      expect(Math.min(...hours)).toBe(8);
      expect(Math.max(...hours)).toBe(21);
    });

    // SCHED5: Random minute within hour for broad sweeps
    it('should schedule broad sweeps at random minutes (0-55)', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const broadSweeps = schedule.scans.filter((s) => s.type === 'broad_sweep');

      const minutes = broadSweeps.map((s) => parseInt(s.scheduledTime.split(':')[1]));

      // All should be valid (0-55)
      minutes.forEach((min) => {
        expect(min).toBeGreaterThanOrEqual(0);
        expect(min).toBeLessThanOrEqual(55);
      });

      // Should have some variety (not all at :00)
      const uniqueMinutes = new Set(minutes);
      expect(uniqueMinutes.size).toBeGreaterThan(1);
    });

    // SCHED6: Watchlist scans with random gaps
    it('should include watchlist scans', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const watchlistScans = schedule.scans.filter((s) => s.type === 'watchlist');

      expect(watchlistScans.length).toBe(mockWatchlist.length);
    });

    it('should include set number in watchlist scans', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const watchlistScans = schedule.scans.filter((s) => s.type === 'watchlist');

      watchlistScans.forEach((scan) => {
        expect(scan.setNumber).toBeDefined();
        expect(mockWatchlist.map((w) => w.set_number)).toContain(scan.setNumber);
      });
    });

    // SCHED7: Minimum 5-minute gap from broad sweep
    it('should maintain minimum gap between watchlist and broad sweep', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const broadSweeps = schedule.scans.filter((s) => s.type === 'broad_sweep');
      const watchlistScans = schedule.scans.filter((s) => s.type === 'watchlist');

      const toMinutes = (time: string) => {
        const parts = time.split(':').map(Number);
        return parts[0] * 60 + parts[1];
      };

      const broadMins = broadSweeps.map((s) => toMinutes(s.scheduledTime));

      watchlistScans.forEach((wl) => {
        const wlMins = toMinutes(wl.scheduledTime);
        const minGap = Math.min(...broadMins.map((bm) => Math.abs(wlMins - bm)));
        expect(minGap).toBeGreaterThanOrEqual(5);
      });
    });

    // SCHED8: Schedule includes version number
    it('should include schedule version from config', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));

      expect(schedule.scheduleVersion).toBe(5);
    });

    // SCHED9: All scans sorted chronologically
    it('should return scans sorted by time', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));

      const times = schedule.scans.map((s) => s.scheduledTime);
      const sortedTimes = [...times].sort();

      expect(times).toEqual(sortedTimes);
    });

    // SCHED10: Each scan has unique ID
    it('should assign unique IDs to all scans', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));

      const ids = schedule.scans.map((s) => s.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include date in scan IDs', async () => {
      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));

      schedule.scans.forEach((scan) => {
        expect(scan.id).toContain('2026-01-21');
      });
    });
  });

  describe('generateRemainingSchedule', () => {
    it('should filter out past scans', async () => {
      // Mock current time as 14:30
      const mockNow = new Date('2026-01-21T14:30:00');
      vi.setSystemTime(mockNow);

      const schedule = await service.generateRemainingSchedule('user-123');

      schedule.scans.forEach((scan) => {
        expect(scan.scheduledTime > '14:30:00').toBe(true);
      });

      vi.useRealTimers();
    });
  });

  describe('Error handling', () => {
    it('should throw if config not found', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      await expect(service.generateSchedule('user-123')).rejects.toThrow(
        'Scanner config not found'
      );
    });

    it('should handle empty watchlist', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockConfig, error: null }),
          };
        }
        if (table === 'vinted_watchlist') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return null;
      });

      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));

      // Should only have broad sweeps
      expect(schedule.scans.every((s) => s.type === 'broad_sweep')).toBe(true);
      expect(schedule.scans.length).toBe(14);
    });
  });

  describe('Operating hours', () => {
    it('should respect custom operating hours', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                operating_hours_start: '10:00',
                operating_hours_end: '18:00',
                schedule_version: 1,
              },
              error: null,
            }),
          };
        }
        if (table === 'vinted_watchlist') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return null;
      });

      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));
      const broadSweeps = schedule.scans.filter((s) => s.type === 'broad_sweep');

      // 10:00 to 18:00 = 8 hours
      expect(broadSweeps.length).toBe(8);

      const hours = broadSweeps.map((s) => parseInt(s.scheduledTime.split(':')[0]));
      expect(Math.min(...hours)).toBe(10);
      expect(Math.max(...hours)).toBe(17);
    });
  });

  describe('Large watchlist handling', () => {
    it('should handle large watchlist (200 items)', async () => {
      const largeWatchlist = Array.from({ length: 200 }, (_, i) => ({
        set_number: `${75000 + i}`,
        asin: null,
        source: 'best_seller' as const,
      }));

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'vinted_scanner_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockConfig, error: null }),
          };
        }
        if (table === 'vinted_watchlist') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: largeWatchlist, error: null }),
          };
        }
        return null;
      });

      const schedule = await service.generateSchedule('user-123', new Date('2026-01-21'));

      // Should complete without error
      expect(schedule.scans.length).toBeGreaterThan(0);

      // Should have broad sweeps
      const broadSweeps = schedule.scans.filter((s) => s.type === 'broad_sweep');
      expect(broadSweeps.length).toBe(14);
    });
  });
});
