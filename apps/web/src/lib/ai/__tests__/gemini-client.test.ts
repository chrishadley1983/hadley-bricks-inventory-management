import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a mock that we can control from tests
const mockGenerateContent = vi.fn();

// Mock the Google GenAI SDK with a proper class constructor
vi.mock('@google/genai', () => {
  // Create a mock class that can be instantiated with `new`
  const MockGoogleGenAI = class {
    models = {
      generateContent: mockGenerateContent,
    };
  };

  return {
    GoogleGenAI: MockGoogleGenAI,
    ThinkingLevel: {
      HIGH: 'HIGH',
      LOW: 'LOW',
      MEDIUM: 'MEDIUM',
    },
  };
});

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Gemini Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, GOOGLE_AI_API_KEY: 'test-api-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ===========================================================================
  // isGeminiConfigured
  // ===========================================================================

  describe('isGeminiConfigured', () => {
    it('should return true when GOOGLE_AI_API_KEY is set', async () => {
      process.env.GOOGLE_AI_API_KEY = 'test-key';
      const { isGeminiConfigured } = await import('../gemini-client');

      expect(isGeminiConfigured()).toBe(true);
    });

    it('should return false when GOOGLE_AI_API_KEY is not set', async () => {
      const savedKey = process.env.GOOGLE_AI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;

      const { isGeminiConfigured } = await import('../gemini-client');

      expect(isGeminiConfigured()).toBe(false);

      // Restore
      process.env.GOOGLE_AI_API_KEY = savedKey;
    });
  });

  // ===========================================================================
  // analyzeImagesWithGemini
  // ===========================================================================

  describe('analyzeImagesWithGemini', () => {
    it('should analyze images and return text response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'This is a LEGO Star Wars set 75192.',
      });

      const { analyzeImagesWithGemini } = await import('../gemini-client');

      const result = await analyzeImagesWithGemini(
        [{ base64: 'imagedata', mimeType: 'image/jpeg' }],
        'What is in this image?'
      );

      expect(result).toBe('This is a LEGO Star Wars set 75192.');
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-3-flash-preview', // Flash is default
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: 'imagedata' } },
            { text: 'What is in this image?' },
          ],
        },
        config: {
          thinkingConfig: {
            thinkingLevel: 'LOW',
          },
        },
      });
    });

    it('should use Pro model when usePrimaryModel is true', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: 'Response' });

      const { analyzeImagesWithGemini } = await import('../gemini-client');

      await analyzeImagesWithGemini(
        [{ base64: 'data', mimeType: 'image/png' }],
        'Analyze this',
        true // usePrimaryModel
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3-pro-preview',
          config: {
            thinkingConfig: {
              thinkingLevel: 'HIGH',
            },
          },
        })
      );
    });

    it('should handle multiple images', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: 'Multiple sets found' });

      const { analyzeImagesWithGemini } = await import('../gemini-client');

      const result = await analyzeImagesWithGemini(
        [
          { base64: 'img1', mimeType: 'image/jpeg' },
          { base64: 'img2', mimeType: 'image/png' },
        ],
        'What sets are these?'
      );

      expect(result).toBe('Multiple sets found');
      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.contents.parts).toHaveLength(3); // 2 images + 1 text
    });

    it('should throw raw error when API fails', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API error'));

      const { analyzeImagesWithGemini } = await import('../gemini-client');

      await expect(
        analyzeImagesWithGemini(
          [{ base64: 'data', mimeType: 'image/jpeg' }],
          'Analyze'
        )
      ).rejects.toThrow('API error');
    });

    it('should return empty string when response has no text', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: null });

      const { analyzeImagesWithGemini } = await import('../gemini-client');

      const result = await analyzeImagesWithGemini(
        [{ base64: 'data', mimeType: 'image/jpeg' }],
        'Analyze'
      );

      expect(result).toBe('');
    });
  });

  // ===========================================================================
  // extractSetNumbersWithGemini
  // ===========================================================================

  describe('extractSetNumbersWithGemini', () => {
    it('should extract set numbers from images', async () => {
      const mockResponse = {
        text: JSON.stringify({
          setNumbers: [
            { setNumber: '75192', confidence: 0.95, textSource: 'box' },
            { setNumber: '42151', confidence: 0.8, textSource: 'label' },
          ],
          otherText: ['Star Wars', 'Technic'],
        }),
      };
      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const { extractSetNumbersWithGemini } = await import('../gemini-client');

      const result = await extractSetNumbersWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(result.setNumbers).toEqual([
        { setNumber: '75192', confidence: 0.95, textSource: 'box' },
        { setNumber: '42151', confidence: 0.8, textSource: 'label' },
      ]);
      expect(result.otherText).toEqual(['Star Wars', 'Technic']);
    });

    it('should handle markdown-wrapped JSON response', async () => {
      const mockResponse = {
        text: '```json\n{"setNumbers": [{"setNumber": "10281", "confidence": 0.9}]}\n```',
      };
      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const { extractSetNumbersWithGemini } = await import('../gemini-client');

      const result = await extractSetNumbersWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(result.setNumbers[0].setNumber).toBe('10281');
    });

    it('should return empty setNumbers when no set numbers found', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ setNumbers: [], otherText: [] }),
      });

      const { extractSetNumbersWithGemini } = await import('../gemini-client');

      const result = await extractSetNumbersWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(result.setNumbers).toEqual([]);
    });

    it('should return empty result on invalid JSON response (graceful error handling)', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Not valid JSON',
      });

      const { extractSetNumbersWithGemini } = await import('../gemini-client');

      const result = await extractSetNumbersWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      // Implementation gracefully handles errors by returning empty result
      expect(result.setNumbers).toEqual([]);
      expect(result.otherText).toEqual([]);
    });

    it('should use Flash model for fast extraction', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ setNumbers: [], otherText: [] }),
      });

      const { extractSetNumbersWithGemini } = await import('../gemini-client');

      await extractSetNumbersWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3-flash-preview',
        })
      );
    });
  });

  // ===========================================================================
  // verifySetNumberWithGemini
  // ===========================================================================

  describe('verifySetNumberWithGemini', () => {
    it('should verify a set number is correct', async () => {
      const mockResponse = {
        text: JSON.stringify({
          verified: true,
          confidence: 0.95,
          notes: 'The box clearly shows LEGO set 75192',
        }),
      };
      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const { verifySetNumberWithGemini } = await import('../gemini-client');

      const result = await verifySetNumberWithGemini(
        [{ base64: 'data', mimeType: 'image/jpeg' }],
        '75192'
      );

      expect(result).toEqual({
        verified: true,
        confidence: 0.95,
        notes: 'The box clearly shows LEGO set 75192',
      });
    });

    it('should return false for non-matching set numbers', async () => {
      const mockResponse = {
        text: JSON.stringify({
          verified: false,
          confidence: 0.2,
          notes: 'The visible set number is 10281, not 75192',
        }),
      };
      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const { verifySetNumberWithGemini } = await import('../gemini-client');

      const result = await verifySetNumberWithGemini(
        [{ base64: 'data', mimeType: 'image/jpeg' }],
        '75192'
      );

      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0.2);
    });

    it('should handle markdown-wrapped JSON response', async () => {
      const mockResponse = {
        text: '```json\n{"verified": true, "confidence": 0.85, "notes": "Verified"}\n```',
      };
      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const { verifySetNumberWithGemini } = await import('../gemini-client');

      const result = await verifySetNumberWithGemini(
        [{ base64: 'data', mimeType: 'image/jpeg' }],
        '42151'
      );

      expect(result.verified).toBe(true);
    });

    it('should return default false result on invalid JSON response (graceful error handling)', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Cannot determine',
      });

      const { verifySetNumberWithGemini } = await import('../gemini-client');

      const result = await verifySetNumberWithGemini(
        [{ base64: 'data', mimeType: 'image/jpeg' }],
        '75192'
      );

      // Implementation gracefully handles errors by returning false with error notes
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.notes).toContain('is not valid JSON');
    });

    it('should use Flash model for verification (speed)', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ verified: true, confidence: 0.9, notes: '' }),
      });

      const { verifySetNumberWithGemini } = await import('../gemini-client');

      await verifySetNumberWithGemini(
        [{ base64: 'data', mimeType: 'image/jpeg' }],
        '75192'
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3-flash-preview',
        })
      );
    });
  });

  // ===========================================================================
  // analyzePhotosWithGemini (full analysis pipeline)
  // ===========================================================================

  describe('analyzePhotosWithGemini', () => {
    // Helper to create a valid response structure
    const createAnalysisResponse = (overrides: Partial<{
      items: Array<{
        itemType: string;
        setNumber: string | null;
        setName: string | null;
        condition: string;
        boxCondition: string | null;
        sealStatus: string;
        damageNotes: string[];
        confidenceScore: number;
        needsReview: boolean;
        reviewReason: string | null;
        rawDescription: string;
        quantity: number;
        minifigDescription: string | null;
        partsEstimate: string | null;
      }>;
      overallNotes: string;
      analysisConfidence: number;
      warnings: string[];
    }> = {}) => ({
      items: overrides.items ?? [
        {
          itemType: 'set',
          setNumber: '75192',
          setName: 'Millennium Falcon',
          condition: 'New',
          boxCondition: 'Excellent',
          sealStatus: 'Factory Sealed',
          damageNotes: [],
          confidenceScore: 0.95,
          needsReview: false,
          reviewReason: null,
          rawDescription: 'LEGO Star Wars Millennium Falcon',
          quantity: 1,
          minifigDescription: null,
          partsEstimate: null,
        },
      ],
      overallNotes: overrides.overallNotes ?? 'Analysis complete',
      analysisConfidence: overrides.analysisConfidence ?? 0.9,
      warnings: overrides.warnings ?? [],
    });

    it('should return full photo analysis structure', async () => {
      const responseData = createAnalysisResponse();
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(responseData),
      });

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      const result = await analyzePhotosWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(result.items[0].setNumber).toBe('75192');
      expect(result.items[0].condition).toBe('New');
      expect(result.items[0].sealStatus).toBe('Factory Sealed');
      expect(result.analysisConfidence).toBe(0.9);
    });

    it('should handle empty items array', async () => {
      const responseData = createAnalysisResponse({
        items: [],
        overallNotes: 'Cannot identify any LEGO sets',
      });
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(responseData),
      });

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      const result = await analyzePhotosWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(result.items).toEqual([]);
      expect(result.overallNotes).toBe('Cannot identify any LEGO sets');
    });

    it('should handle singular image in prompt', async () => {
      const responseData = createAnalysisResponse({
        items: [{
          itemType: 'set',
          setNumber: '60285',
          setName: 'Sports Car',
          condition: 'Used',
          boxCondition: null,
          sealStatus: 'Open Box',
          damageNotes: ['Missing box'],
          confidenceScore: 0.7,
          needsReview: false,
          reviewReason: null,
          rawDescription: 'Used LEGO City car',
          quantity: 1,
          minifigDescription: null,
          partsEstimate: null,
        }],
      });
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(responseData),
      });

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      const result = await analyzePhotosWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(result.items[0].condition).toBe('Used');
    });

    it('should handle plural images in prompt', async () => {
      const responseData = createAnalysisResponse({
        items: [
          {
            itemType: 'set',
            setNumber: '42151',
            setName: 'Bugatti',
            condition: 'New',
            boxCondition: 'Excellent',
            sealStatus: 'Factory Sealed',
            damageNotes: [],
            confidenceScore: 0.95,
            needsReview: false,
            reviewReason: null,
            rawDescription: 'LEGO Technic Bugatti',
            quantity: 1,
            minifigDescription: null,
            partsEstimate: null,
          },
        ],
        overallNotes: 'Multiple angles show complete set',
      });
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(responseData),
      });

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      const result = await analyzePhotosWithGemini([
        { base64: 'data1', mimeType: 'image/jpeg' },
        { base64: 'data2', mimeType: 'image/png' },
        { base64: 'data3', mimeType: 'image/webp' },
      ]);

      expect(result.items[0].setNumber).toBe('42151');
    });

    it('should handle markdown-wrapped JSON response', async () => {
      const responseData = createAnalysisResponse();
      mockGenerateContent.mockResolvedValueOnce({
        text: '```json\n' + JSON.stringify(responseData) + '\n```',
      });

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      const result = await analyzePhotosWithGemini([
        { base64: 'data', mimeType: 'image/jpeg' },
      ]);

      expect(result.items[0].setNumber).toBe('75192');
    });

    it('should throw error on API failure', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API unavailable'));

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      await expect(
        analyzePhotosWithGemini([{ base64: 'data', mimeType: 'image/jpeg' }])
      ).rejects.toThrow('Gemini analysis failed: API unavailable');
    });

    it('should throw error on invalid JSON response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'This is not JSON',
      });

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      await expect(
        analyzePhotosWithGemini([{ base64: 'data', mimeType: 'image/jpeg' }])
      ).rejects.toThrow('Gemini analysis failed');
    });

    it('should use Pro model with HIGH thinking for full analysis', async () => {
      const responseData = createAnalysisResponse();
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(responseData),
      });

      const { analyzePhotosWithGemini } = await import('../gemini-client');

      await analyzePhotosWithGemini([{ base64: 'data', mimeType: 'image/jpeg' }]);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3-pro-preview',
          config: {
            thinkingConfig: {
              thinkingLevel: 'HIGH',
            },
          },
        })
      );
    });
  });
});
