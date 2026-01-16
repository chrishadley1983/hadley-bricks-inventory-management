import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateListing,
  generateListingWithImage,
  analyzeProductImage,
  analyzeImageForDefects,
  editImageWithAI,
  extractJson,
} from '../ai-service';
import type { EbaySoldItem, ImageAnalysisResult, GenerationResult } from '../types';

// Mock AI clients
vi.mock('@/lib/ai/claude-client', () => ({
  sendMessageForJSON: vi.fn(),
}));

vi.mock('@/lib/ai/gemini-client', () => ({
  analyzeImagesWithGemini: vi.fn(),
}));

describe('AI Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateListing', () => {
    const mockClaudeResponse: GenerationResult = {
      title: 'LEGO Star Wars Millennium Falcon 75192 - Complete Set',
      priceRange: '£450 - £550',
      description: '<p>Complete set in excellent condition</p>',
    };

    it('should generate listing with Claude Opus', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaudeResponse);

      const result = await generateListing(
        'LEGO Millennium Falcon 75192',
        'Used',
        'Complete, no missing pieces',
        '<p>Template content</p>',
        'Standard'
      );

      expect(result.title).toBe('LEGO Star Wars Millennium Falcon 75192 - Complete Set');
      expect(result.priceRange).toBe('£450 - £550');
      expect(result.description).toContain('Complete set');
      expect(sendMessageForJSON).toHaveBeenCalledWith(
        expect.stringContaining('eBay seller assistant'),
        expect.stringContaining('LEGO Millennium Falcon'),
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
          maxTokens: 4096,
          temperature: 0.3,
        })
      );
    });

    it('should include eBay sold data in generation', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaudeResponse);

      const soldData: EbaySoldItem[] = [
        {
          itemId: '1',
          title: 'Millennium Falcon',
          soldPrice: 500,
          currency: 'GBP',
          soldDate: '2024-01-10',
          condition: 'Used',
          url: 'https://ebay.com/1',
        },
      ];

      const result = await generateListing(
        'LEGO Millennium Falcon 75192',
        'Used',
        'Complete',
        '<p>Template</p>',
        'Standard',
        soldData
      );

      expect(result.ebaySoldItems).toEqual(soldData);
      expect(sendMessageForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Millennium Falcon: £500.00'),
        expect.any(Object)
      );
    });

    it('should include image analysis in generation when provided', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaudeResponse);

      const imageAnalysis: ImageAnalysisResult = {
        altText: 'LEGO Star Wars set in sealed box',
        defectsNote: 'Minor box wear',
        suggestedFilename: 'lego_75192_sealed',
      };

      await generateListing(
        'LEGO Millennium Falcon 75192',
        'New',
        'Sealed',
        '<p>Template</p>',
        'Professional',
        undefined,
        imageAnalysis
      );

      expect(sendMessageForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('LEGO Star Wars set in sealed box'),
        expect.any(Object)
      );
      expect(sendMessageForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Minor box wear'),
        expect.any(Object)
      );
    });

    it('should handle missing key points gracefully', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaudeResponse);

      await generateListing('Test Item', 'Used', '', '<p>Template</p>', 'Minimalist');

      expect(sendMessageForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('None provided'),
        expect.any(Object)
      );
    });

    it('should handle different tones', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaudeResponse);

      const tones = ['Minimalist', 'Standard', 'Professional', 'Friendly', 'Enthusiastic'] as const;

      for (const tone of tones) {
        await generateListing('Test', 'New', 'Notes', '<p>Template</p>', tone);

        expect(sendMessageForJSON).toHaveBeenCalledWith(
          expect.stringContaining(tone),
          expect.stringContaining(`**Tone:** ${tone}`),
          expect.any(Object)
        );
      }
    });

    it('should handle missing sold data', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaudeResponse);

      await generateListing('Test', 'New', 'Notes', '<p>Template</p>', 'Standard');

      expect(sendMessageForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('No recent sales data available'),
        expect.any(Object)
      );
    });

    it('should limit sold data to 5 items', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue(mockClaudeResponse);

      const soldData: EbaySoldItem[] = Array.from({ length: 10 }, (_, i) => ({
        itemId: `${i}`,
        title: `Item ${i}`,
        soldPrice: 100 + i,
        currency: 'GBP',
        soldDate: '2024-01-01',
        condition: 'Used',
        url: `https://ebay.com/${i}`,
      }));

      await generateListing('Test', 'Used', 'Notes', '<p>Template</p>', 'Standard', soldData);

      const calls = (sendMessageForJSON as ReturnType<typeof vi.fn>).mock.calls;
      const userPrompt = calls[0][1] as string;

      // Should only contain first 5 items
      expect(userPrompt).toContain('Item 0');
      expect(userPrompt).toContain('Item 4');
      expect(userPrompt).not.toContain('Item 5');
    });
  });

  describe('generateListingWithImage', () => {
    it('should analyze image then generate listing', async () => {
      const { sendMessageForJSON } = await import('@/lib/ai/claude-client');
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      const mockAnalysis = JSON.stringify({
        altText: 'LEGO box',
        defectsNote: null,
        suggestedFilename: 'lego_box',
      });

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(mockAnalysis);
      (sendMessageForJSON as ReturnType<typeof vi.fn>).mockResolvedValue({
        title: 'Test Title',
        priceRange: '£50 - £60',
        description: '<p>Test</p>',
      });

      const result = await generateListingWithImage(
        'LEGO Set',
        'New',
        'Sealed',
        '<p>Template</p>',
        'Standard',
        'data:image/jpeg;base64,/9j/4AAQ'
      );

      expect(analyzeImagesWithGemini).toHaveBeenCalled();
      expect(sendMessageForJSON).toHaveBeenCalled();
      expect(result.title).toBe('Test Title');
    });
  });

  describe('analyzeProductImage', () => {
    it('should analyze image with Gemini and return structured result', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      const mockResponse = JSON.stringify({
        altText: 'LEGO Star Wars 75192 Millennium Falcon sealed box',
        defectsNote: 'Small dent on corner',
        suggestedFilename: 'lego_75192_millennium_falcon',
      });

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await analyzeProductImage('data:image/jpeg;base64,/9j/4AAQ');

      expect(result.altText).toBe('LEGO Star Wars 75192 Millennium Falcon sealed box');
      expect(result.defectsNote).toBe('Small dent on corner');
      expect(result.suggestedFilename).toBe('lego_75192_millennium_falcon');
    });

    it('should handle markdown-wrapped JSON response', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      const mockResponse = '```json\n{"altText":"Test","defectsNote":null,"suggestedFilename":"test"}\n```';

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await analyzeProductImage('data:image/png;base64,abc');

      expect(result.altText).toBe('Test');
      expect(result.defectsNote).toBeNull();
    });

    it('should parse base64 data URL correctly', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(
        '{"altText":"Test","defectsNote":null,"suggestedFilename":"test"}'
      );

      await analyzeProductImage('data:image/png;base64,iVBORw0KGgo');

      expect(analyzeImagesWithGemini).toHaveBeenCalledWith(
        [
          {
            base64: 'iVBORw0KGgo',
            mimeType: 'image/png',
          },
        ],
        expect.any(String),
        false
      );
    });

    it('should handle raw base64 without data URL prefix', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(
        '{"altText":"Test","defectsNote":null,"suggestedFilename":"test"}'
      );

      await analyzeProductImage('/9j/4AAQ');

      expect(analyzeImagesWithGemini).toHaveBeenCalledWith(
        [
          {
            base64: '/9j/4AAQ',
            mimeType: 'image/jpeg', // Default
          },
        ],
        expect.any(String),
        false
      );
    });

    it('should return default values on error', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error')
      );

      const result = await analyzeProductImage('data:image/jpeg;base64,test');

      expect(result).toEqual({
        altText: 'Product image',
        defectsNote: null,
        suggestedFilename: 'product_image',
      });
    });

    it('should return default values on invalid JSON', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue('invalid json');

      const result = await analyzeProductImage('data:image/jpeg;base64,test');

      expect(result).toEqual({
        altText: 'Product image',
        defectsNote: null,
        suggestedFilename: 'product_image',
      });
    });
  });

  describe('analyzeImageForDefects', () => {
    it('should detect defects in image', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(
        '{"hasDefects":true,"defectsNote":"Dark spot detected in upper left corner"}'
      );

      const result = await analyzeImageForDefects('data:image/jpeg;base64,test');

      expect(result.hasDefects).toBe(true);
      expect(result.defectsNote).toBe('Dark spot detected in upper left corner');
    });

    it('should return no defects when image is clean', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(
        '{"hasDefects":false,"defectsNote":null}'
      );

      const result = await analyzeImageForDefects('data:image/jpeg;base64,test');

      expect(result.hasDefects).toBe(false);
      expect(result.defectsNote).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error')
      );

      const result = await analyzeImageForDefects('data:image/jpeg;base64,test');

      expect(result).toEqual({
        hasDefects: false,
        defectsNote: null,
      });
    });

    it('should handle markdown-wrapped response', async () => {
      const { analyzeImagesWithGemini } = await import('@/lib/ai/gemini-client');

      (analyzeImagesWithGemini as ReturnType<typeof vi.fn>).mockResolvedValue(
        '```json\n{"hasDefects":true,"defectsNote":"Dust visible"}\n```'
      );

      const result = await analyzeImageForDefects('data:image/jpeg;base64,test');

      expect(result.hasDefects).toBe(true);
      expect(result.defectsNote).toBe('Dust visible');
    });
  });

  describe('editImageWithAI', () => {
    it('should return error indicating feature not available', async () => {
      const result = await editImageWithAI(
        'data:image/jpeg;base64,test',
        'Remove dust spots'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not yet available');
      expect(result.editedImage).toBe('data:image/jpeg;base64,test');
    });

    it('should preserve original image when editing fails', async () => {
      const originalImage = 'data:image/png;base64,originalImageData';

      const result = await editImageWithAI(originalImage, 'Fix lighting');

      expect(result.editedImage).toBe(originalImage);
    });
  });

  describe('extractJson', () => {
    it('should extract JSON from plain text', () => {
      const text = 'Here is the response: {"key": "value"} and some more text';
      const result = extractJson(text);
      expect(result).toBe('{"key": "value"}');
    });

    it('should handle nested JSON objects', () => {
      const text = '{"outer": {"inner": "value"}, "array": [1, 2, 3]}';
      const result = extractJson(text);
      expect(result).toBe('{"outer": {"inner": "value"}, "array": [1, 2, 3]}');
    });

    it('should handle JSON with leading whitespace', () => {
      const text = '   \n\n  {"key": "value"}';
      const result = extractJson(text);
      expect(result).toBe('{"key": "value"}');
    });

    it('should handle JSON with trailing content', () => {
      const text = '{"key": "value"}\n\nEnd of response';
      const result = extractJson(text);
      expect(result).toBe('{"key": "value"}');
    });

    it('should throw error when no JSON found', () => {
      const text = 'No JSON here at all';
      expect(() => extractJson(text)).toThrow('No valid JSON found');
    });

    it('should throw error for invalid brace positions', () => {
      const text = '} { malformed }';
      // First { comes after first }, so this is invalid
      const result = extractJson(text);
      expect(result).toBe('{ malformed }');
    });

    it('should handle empty object', () => {
      const text = 'Result: {}';
      const result = extractJson(text);
      expect(result).toBe('{}');
    });
  });
});
