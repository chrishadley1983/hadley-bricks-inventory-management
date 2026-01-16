import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PushoverService } from '../pushover.service';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('PushoverService', () => {
  let originalUserKey: string | undefined;
  let originalApiToken: string | undefined;
  let originalAppUrl: string | undefined;

  beforeEach(() => {
    originalUserKey = process.env.PUSHOVER_USER_KEY;
    originalApiToken = process.env.PUSHOVER_API_TOKEN;
    originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalUserKey === undefined) {
      delete process.env.PUSHOVER_USER_KEY;
    } else {
      process.env.PUSHOVER_USER_KEY = originalUserKey;
    }
    if (originalApiToken === undefined) {
      delete process.env.PUSHOVER_API_TOKEN;
    } else {
      process.env.PUSHOVER_API_TOKEN = originalApiToken;
    }
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
    vi.restoreAllMocks();
  });

  describe('isEnabled', () => {
    it('returns false when PUSHOVER_USER_KEY is not set', () => {
      delete process.env.PUSHOVER_USER_KEY;
      delete process.env.PUSHOVER_API_TOKEN;
      const service = new PushoverService();
      expect(service.isEnabled()).toBe(false);
    });

    it('returns false when PUSHOVER_API_TOKEN is not set', () => {
      process.env.PUSHOVER_USER_KEY = 'test-user-key';
      delete process.env.PUSHOVER_API_TOKEN;
      const service = new PushoverService();
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when both keys are set', () => {
      process.env.PUSHOVER_USER_KEY = 'test-user-key';
      process.env.PUSHOVER_API_TOKEN = 'test-api-token';
      const service = new PushoverService();
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('send', () => {
    beforeEach(() => {
      process.env.PUSHOVER_USER_KEY = 'test-user-key';
      process.env.PUSHOVER_API_TOKEN = 'test-api-token';
    });

    it('sends notification successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: 'test-request-id' }),
      });

      const service = new PushoverService();
      const result = await service.send({
        message: 'Test message',
        title: 'Test title',
        priority: 0,
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.pushover.net/1/messages.json',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('handles API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            status: 0,
            errors: ['Invalid user key'],
          }),
      });

      const service = new PushoverService();
      const result = await service.send({ message: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid user key');
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new PushoverService();
      const result = await service.send({ message: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('skips sending when not configured', async () => {
      delete process.env.PUSHOVER_USER_KEY;
      delete process.env.PUSHOVER_API_TOKEN;

      const service = new PushoverService();
      const result = await service.send({ message: 'Test' });

      expect(result.success).toBe(true); // Silent skip
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('sendSyncFailure', () => {
    beforeEach(() => {
      process.env.PUSHOVER_USER_KEY = 'test-user-key';
      process.env.PUSHOVER_API_TOKEN = 'test-api-token';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ status: 1, request: 'test-id' }),
      });
    });

    it('sends correct message for price verification failure', async () => {
      const service = new PushoverService();
      await service.sendSyncFailure({
        feedId: 'feed-123',
        itemCount: 2,
        reason: 'Price not visible after 30 mins',
        phase: 'price_verification',
      });

      expect(mockFetch).toHaveBeenCalled();
      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).toContain('Price+verification+timeout');
      expect(callBody).toContain('2+item');
    });

    it('sends correct message for price rejection', async () => {
      const service = new PushoverService();
      await service.sendSyncFailure({
        feedId: 'feed-456',
        itemCount: 1,
        reason: 'Invalid price format',
        phase: 'price_rejected',
      });

      expect(mockFetch).toHaveBeenCalled();
      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).toContain('Price+feed+rejected');
    });

    it('sends correct message for quantity rejection', async () => {
      const service = new PushoverService();
      await service.sendSyncFailure({
        feedId: 'feed-789',
        itemCount: 3,
        reason: 'Invalid quantity',
        phase: 'quantity_rejected',
      });

      expect(mockFetch).toHaveBeenCalled();
      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).toContain('Quantity+feed+rejected');
    });
  });

  describe('sendSyncSuccess', () => {
    beforeEach(() => {
      process.env.PUSHOVER_USER_KEY = 'test-user-key';
      process.env.PUSHOVER_API_TOKEN = 'test-api-token';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ status: 1, request: 'test-id' }),
      });
    });

    it('formats verification time in seconds', async () => {
      const service = new PushoverService();
      await service.sendSyncSuccess({
        feedId: 'feed-123',
        itemCount: 2,
        verificationTime: 45000, // 45 seconds
      });

      expect(mockFetch).toHaveBeenCalled();
      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).toContain('45+sec');
    });

    it('formats verification time in minutes', async () => {
      const service = new PushoverService();
      await service.sendSyncSuccess({
        feedId: 'feed-456',
        itemCount: 1,
        verificationTime: 300000, // 5 minutes
      });

      expect(mockFetch).toHaveBeenCalled();
      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).toContain('5+min');
    });
  });
});
