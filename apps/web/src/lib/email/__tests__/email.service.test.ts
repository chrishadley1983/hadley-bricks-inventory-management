import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../email.service';

// Mock Resend
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'mock-email-id' }, error: null }),
    },
  })),
}));

describe('EmailService', () => {
  let emailService: EmailService;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 'test-api-key';
    // Need to re-import to pick up new env var
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalEnv;
    }
    vi.restoreAllMocks();
  });

  describe('isEnabled', () => {
    it('returns false when RESEND_API_KEY is not set', () => {
      delete process.env.RESEND_API_KEY;
      const service = new EmailService();
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('sendTwoPhaseFailure', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 'test-key';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      emailService = new EmailService();
    });

    it('generates correct failure email content', async () => {
      const params = {
        userEmail: 'test@example.com',
        feedId: 'feed-123',
        failedSkus: ['SKU-001', 'SKU-002'],
        submittedPrice: 44.99,
        verificationDuration: 1800000, // 30 minutes
        itemDetails: [
          { sku: 'SKU-001', asin: 'B0001', setNumber: '75192', itemName: 'Star Wars Set' },
          { sku: 'SKU-002', asin: 'B0002', setNumber: '10297', itemName: 'Boutique Hotel' },
        ],
      };

      // Service should not throw
      await expect(emailService.sendTwoPhaseFailure(params)).resolves.not.toThrow();
    });
  });

  describe('sendFeedRejectionFailure', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 'test-key';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      emailService = new EmailService();
    });

    it('generates correct rejection email for price feed', async () => {
      const params = {
        userEmail: 'test@example.com',
        feedId: 'feed-123',
        phase: 'price' as const,
        errorMessage: 'Invalid price format',
        errorCode: 'PRICE_ERROR',
        itemDetails: [
          { sku: 'SKU-001', asin: 'B0001', setNumber: '75192', itemName: 'Star Wars Set' },
        ],
      };

      await expect(emailService.sendFeedRejectionFailure(params)).resolves.not.toThrow();
    });

    it('generates correct rejection email for quantity feed', async () => {
      const params = {
        userEmail: 'test@example.com',
        feedId: 'feed-456',
        phase: 'quantity' as const,
        errorMessage: 'Invalid quantity',
        itemDetails: [
          { sku: 'SKU-001', asin: 'B0001', setNumber: '75192', itemName: 'Star Wars Set' },
        ],
      };

      await expect(emailService.sendFeedRejectionFailure(params)).resolves.not.toThrow();
    });
  });

  describe('sendTwoPhaseSuccess', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 'test-key';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      emailService = new EmailService();
    });

    it('generates correct success email content', async () => {
      const params = {
        userEmail: 'test@example.com',
        feedId: 'feed-789',
        itemCount: 3,
        priceVerificationTime: 45000, // 45 seconds
        itemDetails: [
          {
            sku: 'SKU-001',
            asin: 'B0001',
            setNumber: '75192',
            itemName: 'Star Wars Set',
            price: 44.99,
          },
          {
            sku: 'SKU-002',
            asin: 'B0002',
            setNumber: '10297',
            itemName: 'Boutique Hotel',
            price: 199.99,
          },
          {
            sku: 'SKU-003',
            asin: 'B0003',
            setNumber: '42115',
            itemName: 'Lamborghini',
            price: 349.99,
          },
        ],
      };

      await expect(emailService.sendTwoPhaseSuccess(params)).resolves.not.toThrow();
    });
  });
});
