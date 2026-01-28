import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DiscordService,
  DiscordColors,
  type DiscordChannel,
} from '../discord.service';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('DiscordService', () => {
  // Store original env vars
  let originalWebhooks: Record<string, string | undefined>;
  let originalAppUrl: string | undefined;

  beforeEach(() => {
    originalWebhooks = {
      alerts: process.env.DISCORD_WEBHOOK_ALERTS,
      opportunities: process.env.DISCORD_WEBHOOK_OPPORTUNITIES,
      'sync-status': process.env.DISCORD_WEBHOOK_SYNC_STATUS,
      'daily-summary': process.env.DISCORD_WEBHOOK_DAILY_SUMMARY,
    };
    originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original env vars
    const envKeys = [
      'DISCORD_WEBHOOK_ALERTS',
      'DISCORD_WEBHOOK_OPPORTUNITIES',
      'DISCORD_WEBHOOK_SYNC_STATUS',
      'DISCORD_WEBHOOK_DAILY_SUMMARY',
    ];
    const channelKeys: DiscordChannel[] = [
      'alerts',
      'opportunities',
      'sync-status',
      'daily-summary',
    ];

    envKeys.forEach((key, i) => {
      const originalValue = originalWebhooks[channelKeys[i]];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    });

    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
    vi.restoreAllMocks();
  });

  // Helper to set up webhooks
  const setupWebhooks = (channels: Partial<Record<DiscordChannel, string>> = {}) => {
    delete process.env.DISCORD_WEBHOOK_ALERTS;
    delete process.env.DISCORD_WEBHOOK_OPPORTUNITIES;
    delete process.env.DISCORD_WEBHOOK_SYNC_STATUS;
    delete process.env.DISCORD_WEBHOOK_DAILY_SUMMARY;

    if (channels.alerts) {
      process.env.DISCORD_WEBHOOK_ALERTS = channels.alerts;
    }
    if (channels.opportunities) {
      process.env.DISCORD_WEBHOOK_OPPORTUNITIES = channels.opportunities;
    }
    if (channels['sync-status']) {
      process.env.DISCORD_WEBHOOK_SYNC_STATUS = channels['sync-status'];
    }
    if (channels['daily-summary']) {
      process.env.DISCORD_WEBHOOK_DAILY_SUMMARY = channels['daily-summary'];
    }
  };

  // =========================================================================
  // F3: isEnabled Method
  // =========================================================================
  describe('isEnabled', () => {
    it('returns false when no webhooks are configured', () => {
      setupWebhooks({});
      const service = new DiscordService();
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when at least one webhook is configured', () => {
      setupWebhooks({ alerts: 'https://discord.com/api/webhooks/test' });
      const service = new DiscordService();
      expect(service.isEnabled()).toBe(true);
    });

    it('returns true when all webhooks are configured', () => {
      setupWebhooks({
        alerts: 'https://discord.com/api/webhooks/alerts',
        opportunities: 'https://discord.com/api/webhooks/opportunities',
        'sync-status': 'https://discord.com/api/webhooks/sync-status',
        'daily-summary': 'https://discord.com/api/webhooks/daily-summary',
      });
      const service = new DiscordService();
      expect(service.isEnabled()).toBe(true);
    });
  });

  // =========================================================================
  // F4: Channel-Specific isEnabled
  // =========================================================================
  describe('isChannelEnabled', () => {
    it('returns true only for configured channels', () => {
      setupWebhooks({
        alerts: 'https://discord.com/api/webhooks/alerts',
        opportunities: 'https://discord.com/api/webhooks/opportunities',
      });
      const service = new DiscordService();

      expect(service.isChannelEnabled('alerts')).toBe(true);
      expect(service.isChannelEnabled('opportunities')).toBe(true);
      expect(service.isChannelEnabled('sync-status')).toBe(false);
      expect(service.isChannelEnabled('daily-summary')).toBe(false);
    });
  });

  // =========================================================================
  // F5-F7: Core Send Method
  // =========================================================================
  describe('send', () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/abc';

    beforeEach(() => {
      setupWebhooks({ alerts: webhookUrl });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    });

    it('POSTs to the correct webhook URL based on channel', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const service = new DiscordService();
      await service.send('alerts', { title: 'Test' });

      expect(mockFetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('sends embed in correct format with embeds array', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const service = new DiscordService();
      await service.send('alerts', { title: 'Test', description: 'Message' });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toHaveProperty('embeds');
      expect(Array.isArray(callBody.embeds)).toBe(true);
      expect(callBody.embeds[0].title).toBe('Test');
      expect(callBody.embeds[0].description).toBe('Message');
    });

    it('skips sending when channel not configured', async () => {
      const service = new DiscordService();
      const result = await service.send('sync-status', { title: 'Test' });

      expect(result.success).toBe(true); // Silent skip
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // F8: sendAlert Method
  // =========================================================================
  describe('sendAlert', () => {
    beforeEach(() => {
      setupWebhooks({ alerts: 'https://discord.com/api/webhooks/alerts' });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({ ok: true });
    });

    it('sends to alerts channel with red colour', async () => {
      const service = new DiscordService();
      await service.sendAlert({
        title: 'Test Alert',
        message: 'Something went wrong',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.RED);
    });

    it('includes URL as embed url when provided', async () => {
      const service = new DiscordService();
      await service.sendAlert({
        title: 'Test Alert',
        message: 'Something went wrong',
        url: 'https://example.com',
        urlTitle: 'View Details',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].url).toBe('https://example.com');
    });
  });

  // =========================================================================
  // F9-F11: sendOpportunity Method
  // =========================================================================
  describe('sendOpportunity', () => {
    beforeEach(() => {
      setupWebhooks({ opportunities: 'https://discord.com/api/webhooks/opportunities' });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({ ok: true });
    });

    it('sends to opportunities channel with correct embed structure', async () => {
      const service = new DiscordService();
      await service.sendOpportunity({
        setNumber: '75192',
        setName: 'Millennium Falcon',
        vintedPrice: 400,
        amazonPrice: 700,
        cogPercent: 28,
        profit: 150,
        vintedUrl: 'https://vinted.co.uk/item/123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/opportunities',
        expect.anything()
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = callBody.embeds[0];

      expect(embed.title).toContain('75192');
      expect(embed.title).toContain('Millennium Falcon');
      expect(embed.url).toBe('https://vinted.co.uk/item/123');
      expect(embed.fields).toHaveLength(5);
      expect(embed.fields[0].name).toBe('Vinted Price');
      expect(embed.fields[0].value).toBe('£400.00');
      expect(embed.fields[1].name).toBe('Amazon Price');
      expect(embed.fields[1].value).toBe('£700.00');
      expect(embed.fields[2].name).toBe('COG%');
      expect(embed.fields[2].value).toBe('28%');
      expect(embed.fields[3].name).toBe('Profit');
      expect(embed.fields[3].value).toBe('£150.00');
      expect(embed.fields[4].name).toBe('View in App');
    });

    it('uses green colour for COG < 30%', async () => {
      const service = new DiscordService();
      await service.sendOpportunity({
        setNumber: '75192',
        setName: 'Test Set',
        vintedPrice: 100,
        amazonPrice: 200,
        cogPercent: 25,
        profit: 50,
        vintedUrl: 'https://vinted.co.uk/item/123',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.GREEN);
    });

    it('uses yellow colour for COG 30-40%', async () => {
      const service = new DiscordService();
      await service.sendOpportunity({
        setNumber: '75192',
        setName: 'Test Set',
        vintedPrice: 100,
        amazonPrice: 200,
        cogPercent: 35,
        profit: 30,
        vintedUrl: 'https://vinted.co.uk/item/123',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.YELLOW);
    });

    it('uses orange colour for COG > 40%', async () => {
      const service = new DiscordService();
      await service.sendOpportunity({
        setNumber: '75192',
        setName: 'Test Set',
        vintedPrice: 100,
        amazonPrice: 200,
        cogPercent: 45,
        profit: 10,
        vintedUrl: 'https://vinted.co.uk/item/123',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.ORANGE);
    });
  });

  // =========================================================================
  // F12-F13: sendSyncStatus Method
  // =========================================================================
  describe('sendSyncStatus', () => {
    beforeEach(() => {
      setupWebhooks({ 'sync-status': 'https://discord.com/api/webhooks/sync-status' });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({ ok: true });
    });

    it('sends to sync-status channel', async () => {
      const service = new DiscordService();
      await service.sendSyncStatus({
        title: 'Sync Started',
        message: 'Starting eBay price sync',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/sync-status',
        expect.anything()
      );
    });

    it('uses green colour for success=true', async () => {
      const service = new DiscordService();
      await service.sendSyncStatus({
        title: 'Sync Complete',
        message: 'All items synced',
        success: true,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.GREEN);
    });

    it('uses blue colour for info/started (success=undefined)', async () => {
      const service = new DiscordService();
      await service.sendSyncStatus({
        title: 'Sync Started',
        message: 'Starting sync',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.BLUE);
    });

    it('uses orange colour for partial success (success=false)', async () => {
      const service = new DiscordService();
      await service.sendSyncStatus({
        title: 'Sync Partial',
        message: 'Some items failed',
        success: false,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.ORANGE);
    });
  });

  // =========================================================================
  // F14: sendDailySummary Method
  // =========================================================================
  describe('sendDailySummary', () => {
    beforeEach(() => {
      setupWebhooks({ 'daily-summary': 'https://discord.com/api/webhooks/daily-summary' });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({ ok: true });
    });

    it('sends to daily-summary channel with blue colour', async () => {
      const service = new DiscordService();
      await service.sendDailySummary({
        title: 'Daily Summary',
        fields: [
          { name: 'Sales', value: '10', inline: true },
          { name: 'Revenue', value: '£500', inline: true },
        ],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/daily-summary',
        expect.anything()
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(DiscordColors.BLUE);
      expect(callBody.embeds[0].fields).toHaveLength(2);
    });
  });

  // =========================================================================
  // F15-F20: Pushover-Compatible Methods
  // =========================================================================
  describe('Pushover-compatible methods', () => {
    beforeEach(() => {
      setupWebhooks({
        alerts: 'https://discord.com/api/webhooks/alerts',
        opportunities: 'https://discord.com/api/webhooks/opportunities',
        'sync-status': 'https://discord.com/api/webhooks/sync-status',
        'daily-summary': 'https://discord.com/api/webhooks/daily-summary',
      });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({ ok: true });
    });

    it('sendVintedOpportunity sends to opportunities channel', async () => {
      const service = new DiscordService();
      await service.sendVintedOpportunity({
        setNumber: '75192',
        setName: 'Millennium Falcon',
        vintedPrice: 400,
        amazonPrice: 700,
        cogPercent: 28,
        profit: 150,
        vintedUrl: 'https://vinted.co.uk/item/123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/opportunities',
        expect.anything()
      );
    });

    it('sendVintedCaptchaWarning sends to alerts channel', async () => {
      const service = new DiscordService();
      await service.sendVintedCaptchaWarning();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/alerts',
        expect.anything()
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].title).toContain('CAPTCHA');
    });

    it('sendVintedDailySummary sends to daily-summary channel', async () => {
      const service = new DiscordService();
      await service.sendVintedDailySummary({
        broadSweeps: 5,
        watchlistScans: 10,
        opportunitiesFound: 3,
        nearMissesFound: 2,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/daily-summary',
        expect.anything()
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].fields).toHaveLength(4);
      expect(callBody.embeds[0].fields[0].value).toBe('5');
      expect(callBody.embeds[0].fields[1].value).toBe('10');
      expect(callBody.embeds[0].fields[2].value).toBe('3');
      expect(callBody.embeds[0].fields[3].value).toBe('2');
    });

    it('sendVintedConsecutiveFailures sends to alerts channel', async () => {
      const service = new DiscordService();
      await service.sendVintedConsecutiveFailures(5);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/alerts',
        expect.anything()
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].description).toContain('5 consecutive');
    });

    it('sendSyncFailure sends to alerts channel', async () => {
      const service = new DiscordService();
      await service.sendSyncFailure({
        feedId: 'feed-123',
        itemCount: 2,
        reason: 'Price not visible',
        phase: 'price_verification',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/alerts',
        expect.anything()
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].title).toContain('Amazon Sync Failed');
      expect(callBody.embeds[0].description).toContain('Price verification timeout');
    });

    it('sendSyncSuccess sends to sync-status channel', async () => {
      const service = new DiscordService();
      await service.sendSyncSuccess({
        feedId: 'feed-123',
        itemCount: 2,
        verificationTime: 45000,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/sync-status',
        expect.anything()
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].title).toContain('Amazon Sync Complete');
      expect(callBody.embeds[0].description).toContain('45 sec');
    });

    it('sendSyncSuccess formats verification time in minutes', async () => {
      const service = new DiscordService();
      await service.sendSyncSuccess({
        feedId: 'feed-456',
        itemCount: 1,
        verificationTime: 300000, // 5 minutes
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].description).toContain('5 min');
    });
  });

  // =========================================================================
  // F21-F24: Embed Features
  // =========================================================================
  describe('Embed features', () => {
    beforeEach(() => {
      setupWebhooks({ alerts: 'https://discord.com/api/webhooks/alerts' });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      mockFetch.mockResolvedValue({ ok: true });
    });

    it('includes timestamp in ISO 8601 format', async () => {
      const service = new DiscordService();
      await service.sendAlert({ title: 'Test', message: 'Message' });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const timestamp = callBody.embeds[0].timestamp;
      expect(timestamp).toBeDefined();
      // Validate ISO 8601 format
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('includes footer with "Hadley Bricks" branding', async () => {
      const service = new DiscordService();
      await service.sendAlert({ title: 'Test', message: 'Message' });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].footer.text).toBe('Hadley Bricks');
    });

    it('includes View in App link with app URL', async () => {
      setupWebhooks({ opportunities: 'https://discord.com/api/webhooks/opportunities' });
      const service = new DiscordService();
      await service.sendOpportunity({
        setNumber: '75192',
        setName: 'Test Set',
        vintedPrice: 100,
        amazonPrice: 200,
        cogPercent: 25,
        profit: 50,
        vintedUrl: 'https://vinted.co.uk/item/123',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const viewInAppField = callBody.embeds[0].fields.find(
        (f: { name: string }) => f.name === 'View in App'
      );
      expect(viewInAppField).toBeDefined();
      expect(viewInAppField.value).toContain('http://localhost:3000');
    });
  });

  // =========================================================================
  // E1-E5: Error Handling
  // =========================================================================
  describe('Error handling', () => {
    beforeEach(() => {
      setupWebhooks({ alerts: 'https://discord.com/api/webhooks/alerts' });
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    });

    it('logs error with channel name on webhook failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      const service = new DiscordService();
      await service.send('alerts', { title: 'Test' });

      // Implementation logs as single string: "[DiscordService] Channel alerts failed with status 400: Bad Request"
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[DiscordService\].*alerts.*400/)
      );
      consoleSpy.mockRestore();
    });

    it('returns { success: false, error } on failure without throwing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const service = new DiscordService();
      const result = await service.send('alerts', { title: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('logs warning when channel not configured', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const service = new DiscordService();
      await service.send('sync-status', { title: 'Test' });

      // Implementation logs as single string: "[DiscordService] Channel sync-status not configured - skipping"
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[DiscordService\].*sync-status.*not configured/)
      );
      consoleSpy.mockRestore();
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new DiscordService();
      const result = await service.send('alerts', { title: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('handles timeout with AbortController', async () => {
      // Create an AbortError that matches the check: err instanceof Error && err.name === 'AbortError'
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(abortError), 100);
          })
      );

      const service = new DiscordService();
      const result = await service.send('alerts', { title: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timed out');
    });
  });

  // =========================================================================
  // C1-C3: Configuration
  // =========================================================================
  describe('Configuration', () => {
    it('reads all four webhook env vars', () => {
      setupWebhooks({
        alerts: 'https://discord.com/api/webhooks/1',
        opportunities: 'https://discord.com/api/webhooks/2',
        'sync-status': 'https://discord.com/api/webhooks/3',
        'daily-summary': 'https://discord.com/api/webhooks/4',
      });

      const service = new DiscordService();

      expect(service.isChannelEnabled('alerts')).toBe(true);
      expect(service.isChannelEnabled('opportunities')).toBe(true);
      expect(service.isChannelEnabled('sync-status')).toBe(true);
      expect(service.isChannelEnabled('daily-summary')).toBe(true);
    });

    it('works with partial configuration (1 webhook)', async () => {
      setupWebhooks({ alerts: 'https://discord.com/api/webhooks/alerts' });
      mockFetch.mockResolvedValue({ ok: true });

      const service = new DiscordService();
      expect(service.isEnabled()).toBe(true);

      // Configured channel works
      const result1 = await service.send('alerts', { title: 'Test' });
      expect(result1.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Unconfigured channel skips silently
      const result2 = await service.send('opportunities', { title: 'Test' });
      expect(result2.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional call
    });

    it('logs channel status on instantiation', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      setupWebhooks({
        alerts: 'https://discord.com/api/webhooks/1',
        opportunities: 'https://discord.com/api/webhooks/2',
      });

      new DiscordService();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Configured channels'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Missing channels'));
      consoleSpy.mockRestore();
    });
  });
});
