/**
 * Tests for /api/ai API Routes
 *
 * Tests the AI-powered operations:
 * - POST /api/ai/parse-purchase - Parse natural language purchase
 * - POST /api/ai/calculate-distance - Calculate distance between postcodes
 * - POST /api/ai/parse-inventory - Parse inventory descriptions
 * - POST /api/ai/extract-set-numbers - Extract set numbers from images
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Store original env
const originalEnv = process.env.ANTHROPIC_API_KEY;

// Mock the Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Mock the AI module - using factory pattern to avoid hoisting issues
vi.mock('@/lib/ai', () => {
  const mockSendMessageForJSON = vi.fn();
  const mockSendMessageWithImagesForJSON = vi.fn();

  return {
    sendMessageForJSON: mockSendMessageForJSON,
    sendMessageWithImagesForJSON: mockSendMessageWithImagesForJSON,
    PARSE_PURCHASE_SYSTEM_PROMPT: 'mock purchase prompt',
    CALCULATE_DISTANCE_SYSTEM_PROMPT: 'mock distance prompt',
    PARSE_INVENTORY_SYSTEM_PROMPT: 'mock inventory prompt',
    EXTRACT_SET_NUMBERS_SYSTEM_PROMPT: 'mock extract prompt',
    createParsePurchaseMessage: vi.fn((text: string) => text),
    createCalculateDistanceMessage: vi.fn((from: string, to: string) => `${from}-${to}`),
    createParseInventoryMessage: vi.fn((text: string) => text),
    createExtractSetNumbersMessage: vi.fn((count: number) => `${count} images`),
  };
});

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import { createClient } from '@/lib/supabase/server';
import {
  sendMessageForJSON,
  sendMessageWithImagesForJSON,
} from '@/lib/ai';
import { POST as ParsePurchase } from '../ai/parse-purchase/route';
import { POST as CalculateDistance } from '../ai/calculate-distance/route';
import { POST as ParseInventory } from '../ai/parse-inventory/route';
import { POST as ExtractSetNumbers } from '../ai/extract-set-numbers/route';

// Get typed references to mocked functions
const mockSendMessageForJSON = sendMessageForJSON as ReturnType<typeof vi.fn>;
const mockSendMessageWithImagesForJSON = sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>;

// ============================================================================
// TEST HELPERS
// ============================================================================

function createAuthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      }),
    },
  };
}

function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      }),
    },
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('/api/ai API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  // ==========================================================================
  // POST /api/ai/parse-purchase
  // ==========================================================================

  describe('POST /api/ai/parse-purchase', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/parse-purchase', {
        method: 'POST',
        body: JSON.stringify({ text: 'Bought LEGO set for £50' }),
      });
      const response = await ParsePurchase(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing text', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/parse-purchase', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await ParsePurchase(request);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
    });

    it('should return 400 for empty text', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/parse-purchase', {
        method: 'POST',
        body: JSON.stringify({ text: '' }),
      });
      const response = await ParsePurchase(request);

      expect(response.status).toBe(400);
    });

    it('should return 503 when API key is not configured', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      delete process.env.ANTHROPIC_API_KEY;

      const request = new NextRequest('http://localhost:3000/api/ai/parse-purchase', {
        method: 'POST',
        body: JSON.stringify({ text: 'Test purchase' }),
      });
      const response = await ParsePurchase(request);

      expect(response.status).toBe(503);
      const json = await response.json();
      expect(json.error).toBe('AI service not configured');
    });

    it('should parse purchase successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageForJSON.mockResolvedValue({
        short_description: 'LEGO Millennium Falcon',
        cost: 50,
        confidence: 0.95,
        source: 'eBay',
      });

      const request = new NextRequest('http://localhost:3000/api/ai/parse-purchase', {
        method: 'POST',
        body: JSON.stringify({ text: 'Bought LEGO Millennium Falcon for £50 on eBay' }),
      });
      const response = await ParsePurchase(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.short_description).toBe('LEGO Millennium Falcon');
      expect(json.data.cost).toBe(50);
    });

    it('should return 422 with fallback on AI error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageForJSON.mockRejectedValue(new Error('AI service unavailable'));

      const request = new NextRequest('http://localhost:3000/api/ai/parse-purchase', {
        method: 'POST',
        body: JSON.stringify({ text: 'Test purchase description' }),
      });
      const response = await ParsePurchase(request);

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error).toBe('AI parsing failed');
      expect(json.fallback).toBeDefined();
    });
  });

  // ==========================================================================
  // POST /api/ai/calculate-distance
  // ==========================================================================

  describe('POST /api/ai/calculate-distance', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/calculate-distance', {
        method: 'POST',
        body: JSON.stringify({ fromPostcode: 'SW1A 1AA', toPostcode: 'EC1A 1BB' }),
      });
      const response = await CalculateDistance(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing postcodes', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/calculate-distance', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await CalculateDistance(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty postcode', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/calculate-distance', {
        method: 'POST',
        body: JSON.stringify({ fromPostcode: '', toPostcode: 'EC1A 1BB' }),
      });
      const response = await CalculateDistance(request);

      expect(response.status).toBe(400);
    });

    it('should return 503 when API key is not configured', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      delete process.env.ANTHROPIC_API_KEY;

      const request = new NextRequest('http://localhost:3000/api/ai/calculate-distance', {
        method: 'POST',
        body: JSON.stringify({ fromPostcode: 'SW1A 1AA', toPostcode: 'EC1A 1BB' }),
      });
      const response = await CalculateDistance(request);

      expect(response.status).toBe(503);
    });

    it('should calculate distance successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageForJSON.mockResolvedValue({
        distance_miles: 5.2,
        round_trip_miles: 10.4,
        from_postcode: 'SW1A 1AA',
        to_postcode: 'EC1A 1BB',
        estimated: true,
        explanation: 'Estimated driving distance',
      });

      const request = new NextRequest('http://localhost:3000/api/ai/calculate-distance', {
        method: 'POST',
        body: JSON.stringify({ fromPostcode: 'SW1A 1AA', toPostcode: 'EC1A 1BB' }),
      });
      const response = await CalculateDistance(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.distance).toBe(5.2);
      expect(json.data.roundTrip).toBe(10.4);
    });

    it('should return 422 on AI error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageForJSON.mockRejectedValue(new Error('AI service unavailable'));

      const request = new NextRequest('http://localhost:3000/api/ai/calculate-distance', {
        method: 'POST',
        body: JSON.stringify({ fromPostcode: 'SW1A 1AA', toPostcode: 'EC1A 1BB' }),
      });
      const response = await CalculateDistance(request);

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error).toBe('Distance calculation failed');
    });
  });

  // ==========================================================================
  // POST /api/ai/parse-inventory
  // ==========================================================================

  describe('POST /api/ai/parse-inventory', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/parse-inventory', {
        method: 'POST',
        body: JSON.stringify({ text: '3x 75192 Millennium Falcon' }),
      });
      const response = await ParseInventory(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing text', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/parse-inventory', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await ParseInventory(request);

      expect(response.status).toBe(400);
    });

    it('should return 503 when API key is not configured', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      delete process.env.ANTHROPIC_API_KEY;

      const request = new NextRequest('http://localhost:3000/api/ai/parse-inventory', {
        method: 'POST',
        body: JSON.stringify({ text: 'Test inventory' }),
      });
      const response = await ParseInventory(request);

      expect(response.status).toBe(503);
    });

    it('should parse inventory successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageForJSON.mockResolvedValue({
        items: [
          { set_number: '75192', item_name: 'Millennium Falcon', quantity: 3, confidence: 0.95 },
          { set_number: '10179', item_name: 'UCS Falcon', quantity: 1, confidence: 0.9 },
        ],
        total_items: 4,
      });

      const request = new NextRequest('http://localhost:3000/api/ai/parse-inventory', {
        method: 'POST',
        body: JSON.stringify({ text: '3x 75192 Millennium Falcon, 1x 10179 UCS Falcon' }),
      });
      const response = await ParseInventory(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.items).toHaveLength(2);
      expect(json.data.total_items).toBe(4);
    });

    it('should return 422 with fallback on AI error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageForJSON.mockRejectedValue(new Error('AI service unavailable'));

      const request = new NextRequest('http://localhost:3000/api/ai/parse-inventory', {
        method: 'POST',
        body: JSON.stringify({ text: 'Test inventory description' }),
      });
      const response = await ParseInventory(request);

      expect(response.status).toBe(422);
      const json = await response.json();
      expect(json.error).toBe('AI parsing failed');
      expect(json.fallback.items).toEqual([]);
    });

    it('should return 422 for invalid AI response structure', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageForJSON.mockResolvedValue({
        items: [], // Empty items array
        total_items: 0,
      });

      const request = new NextRequest('http://localhost:3000/api/ai/parse-inventory', {
        method: 'POST',
        body: JSON.stringify({ text: 'Test inventory' }),
      });
      const response = await ParseInventory(request);

      expect(response.status).toBe(422);
    });
  });

  // ==========================================================================
  // POST /api/ai/extract-set-numbers
  // ==========================================================================

  describe('POST /api/ai/extract-set-numbers', () => {
    const validBase64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    it('should return 401 when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(createUnauthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({
          images: [{ base64: validBase64Image, mediaType: 'image/png' }],
        }),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing images', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for empty images array', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({ images: [] }),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid media type', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({
          images: [{ base64: validBase64Image, mediaType: 'image/bmp' }],
        }),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(400);
    });

    it('should return 503 when API key is not configured', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      delete process.env.ANTHROPIC_API_KEY;

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({
          images: [{ base64: validBase64Image, mediaType: 'image/png' }],
        }),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(503);
    });

    it('should extract set numbers successfully', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageWithImagesForJSON.mockResolvedValue({
        extractions: [
          { set_number: '75192', confidence: 0.95 },
          { set_number: '10179', confidence: 0.85 },
        ],
        notes: 'Found 2 LEGO set numbers in the image',
      });

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({
          images: [{ base64: validBase64Image, mediaType: 'image/png' }],
        }),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.extractions).toHaveLength(2);
      expect(json.data.total_found).toBe(2);
    });

    it('should return 500 on AI error', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageWithImagesForJSON.mockRejectedValue(new Error('Vision API error'));

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({
          images: [{ base64: validBase64Image, mediaType: 'image/png' }],
        }),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(500);
    });

    it('should filter out empty set numbers from response', async () => {
      vi.mocked(createClient).mockResolvedValue(createAuthenticatedClient() as never);
      mockSendMessageWithImagesForJSON.mockResolvedValue({
        extractions: [
          { set_number: '75192', confidence: 0.95 },
          { set_number: '', confidence: 0.3 }, // Empty should be filtered
          { set_number: null, confidence: 0.2 }, // Null should be filtered
        ],
        notes: 'Some extractions were unclear',
      });

      const request = new NextRequest('http://localhost:3000/api/ai/extract-set-numbers', {
        method: 'POST',
        body: JSON.stringify({
          images: [{ base64: validBase64Image, mediaType: 'image/png' }],
        }),
      });
      const response = await ExtractSetNumbers(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.extractions).toHaveLength(1);
      expect(json.data.total_found).toBe(1);
    });
  });
});
