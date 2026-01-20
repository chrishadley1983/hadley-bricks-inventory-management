import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('../../ai/claude-client', () => ({
  sendMessageWithImagesForJSON: vi.fn(),
}));

vi.mock('../../ai/gemini-client', () => ({
  extractSetNumbersWithGemini: vi.fn(),
  isGeminiConfigured: vi.fn(() => true),
  analyzePhotosWithGemini: vi.fn(),
}));

vi.mock('../../brickognize/client', () => ({
  identifyAllItemsFromImages: vi.fn(),
  getBestSetMatch: vi.fn(),
  getMinifigMatches: vi.fn(),
  getPartMatches: vi.fn(),
}));

vi.mock('../image-chunking.service', () => ({
  processImagesForChunking: vi.fn(),
  isChunkingAvailable: vi.fn(() => false), // Disable chunking by default in tests
}));

vi.mock('../../ai/prompts/evaluate-photo-lot', () => ({
  PHOTO_LOT_SYSTEM_PROMPT: 'Mock system prompt',
  createPhotoLotUserMessage: vi.fn(() => 'Mock user message'),
  validateOpusResponse: vi.fn((response) => response),
  SET_VERIFICATION_SYSTEM_PROMPT: 'Mock verification prompt',
  createVerificationRequest: vi.fn(() => 'Mock verification request'),
}));

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Photo Analysis Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  // ===========================================================================
  // analyzePhotos - Basic functionality
  // ===========================================================================

  describe('analyzePhotos', () => {
    it('should return empty result when no images provided', async () => {
      const { analyzePhotos } = await import('../photo-analysis.service');

      const result = await analyzePhotos([]);

      expect(result.items).toEqual([]);
      expect(result.overallNotes).toContain('No images provided');
      expect(result.warnings).toContain('No images were provided');
      expect(result.analysisConfidence).toBe(0);
    });

    it('should analyze images with Claude Opus as default primary model', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { extractSetNumbersWithGemini } = await import(
        '../../ai/gemini-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      // Mock Claude Opus response
      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [
            {
              itemType: 'set',
              setNumber: '75192',
              setName: 'Millennium Falcon',
              condition: 'New',
              boxCondition: 'Excellent',
              sealStatus: 'Factory Sealed',
              damageNotes: [],
              confidenceScore: 0.92,
              needsReview: false,
              reviewReason: null,
              rawDescription: 'LEGO Star Wars set',
              quantity: 1,
            },
          ],
          overallNotes: 'One sealed set',
          analysisConfidence: 0.92,
          warnings: [],
        })
        // Mock verification pass response
        .mockResolvedValueOnce({
          verifications: [
            {
              providedSetNumber: '75192',
              isCorrect: true,
              reason: 'Set number confirmed',
            },
          ],
        });

      // Mock Gemini verification
      (extractSetNumbersWithGemini as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        setNumbers: [{ setNumber: '75192', confidence: 0.95 }],
        otherText: [],
        rawResponse: '',
      });

      // Mock Brickognize
      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        items: [],
      });

      const { analyzePhotos } = await import('../photo-analysis.service');

      const result = await analyzePhotos([
        { base64: 'imagedata', mediaType: 'image/jpeg' },
      ]);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].setNumber).toBe('75192');
      expect(result.modelsUsed).toContain('opus');
      expect(sendMessageWithImagesForJSON).toHaveBeenCalled();
    });

    it('should use Gemini as primary model when configured', async () => {
      const { analyzePhotosWithGemini, isGeminiConfigured } = await import(
        '../../ai/gemini-client'
      );
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      (isGeminiConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Mock Gemini primary response
      (analyzePhotosWithGemini as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        items: [
          {
            itemType: 'set',
            setNumber: '60285',
            setName: 'Sports Car',
            condition: 'New',
            boxCondition: 'Good',
            sealStatus: 'Factory Sealed',
            damageNotes: [],
            confidenceScore: 0.88,
            needsReview: false,
            reviewReason: null,
            rawDescription: 'City set',
            quantity: 1,
          },
        ],
        overallNotes: 'City set',
        analysisConfidence: 0.88,
        warnings: [],
      });

      // Mock Claude verification (used when Gemini is primary)
      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          setNumbers: [{ number: '60285', confidence: 0.9 }],
        })
        // Mock verification pass
        .mockResolvedValueOnce({
          verifications: [
            {
              providedSetNumber: '60285',
              isCorrect: true,
              reason: 'Confirmed',
            },
          ],
        });

      // Mock Brickognize
      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        items: [],
      });

      const { analyzePhotos } = await import('../photo-analysis.service');

      const result = await analyzePhotos(
        [{ base64: 'data', mediaType: 'image/jpeg' }],
        { primaryModel: 'gemini', useGeminiVerification: true, useBrickognize: true }
      );

      expect(result.modelsUsed).toContain('gemini');
      expect(analyzePhotosWithGemini).toHaveBeenCalled();
    });

    it('should include processing time in result', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );

      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [],
          overallNotes: 'Empty',
          analysisConfidence: 0,
          warnings: [],
        })
        .mockResolvedValueOnce({ verifications: [] });

      const { analyzePhotos } = await import('../photo-analysis.service');

      const result = await analyzePhotos([
        { base64: 'data', mediaType: 'image/jpeg' },
      ]);

      expect(result.processingTimeMs).toBeDefined();
      expect(typeof result.processingTimeMs).toBe('number');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should pass listing description to primary model', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { createPhotoLotUserMessage } = await import(
        '../../ai/prompts/evaluate-photo-lot'
      );

      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [],
          overallNotes: '',
          analysisConfidence: 0,
          warnings: [],
        })
        .mockResolvedValueOnce({ verifications: [] });

      const { analyzePhotos } = await import('../photo-analysis.service');

      await analyzePhotos([{ base64: 'data', mediaType: 'image/jpeg' }], {
        useGeminiVerification: true,
        useBrickognize: true,
        listingDescription: 'Selling my sealed sets',
      });

      expect(createPhotoLotUserMessage).toHaveBeenCalledWith(
        1,
        'Selling my sealed sets'
      );
    });
  });

  // ===========================================================================
  // analyzePhotos - Model verification
  // ===========================================================================

  describe('model verification', () => {
    it('should boost confidence when models agree', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { extractSetNumbersWithGemini } = await import(
        '../../ai/gemini-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      // Claude identifies 75192
      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [
            {
              itemType: 'set',
              setNumber: '75192',
              setName: 'Millennium Falcon',
              condition: 'New',
              boxCondition: 'Excellent',
              sealStatus: 'Factory Sealed',
              damageNotes: [],
              confidenceScore: 0.8,
              needsReview: false,
              reviewReason: null,
              rawDescription: 'Star Wars set',
              quantity: 1,
            },
          ],
          overallNotes: '',
          analysisConfidence: 0.8,
          warnings: [],
        })
        .mockResolvedValueOnce({
          verifications: [
            {
              providedSetNumber: '75192',
              isCorrect: true,
              reason: 'Confirmed',
            },
          ],
        });

      // Gemini also identifies 75192
      (extractSetNumbersWithGemini as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        setNumbers: [{ setNumber: '75192', confidence: 0.9 }],
        otherText: [],
        rawResponse: '',
      });

      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        items: [],
      });

      const { analyzePhotos } = await import('../photo-analysis.service');

      const result = await analyzePhotos([
        { base64: 'data', mediaType: 'image/jpeg' },
      ]);

      // Base confidence 0.8 + 0.15 agreement bonus + 0.05 verification = 0.95 (capped at 1.0)
      expect(result.items[0].confidenceScore).toBeGreaterThan(0.8);
      expect(result.items[0].modelsAgree).toBe(true);
    });

    it('should flag items when models disagree', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { extractSetNumbersWithGemini } = await import(
        '../../ai/gemini-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      // Claude identifies 75192
      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [
            {
              itemType: 'set',
              setNumber: '75192',
              setName: 'Millennium Falcon',
              condition: 'New',
              boxCondition: 'Good',
              sealStatus: 'Factory Sealed',
              damageNotes: [],
              confidenceScore: 0.85,
              needsReview: false,
              reviewReason: null,
              rawDescription: 'Star Wars set',
              quantity: 1,
            },
          ],
          overallNotes: '',
          analysisConfidence: 0.85,
          warnings: [],
        })
        .mockResolvedValueOnce({
          verifications: [
            {
              providedSetNumber: '75192',
              isCorrect: true,
              reason: 'Confirmed',
            },
          ],
        });

      // Gemini identifies different set
      (extractSetNumbersWithGemini as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        setNumbers: [{ setNumber: '75193', confidence: 0.88 }],
        otherText: [],
        rawResponse: '',
      });

      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        items: [],
      });

      const { analyzePhotos } = await import('../photo-analysis.service');

      const result = await analyzePhotos([
        { base64: 'data', mediaType: 'image/jpeg' },
      ]);

      expect(result.items[0].modelsAgree).toBe(false);
      expect(result.items[0].needsReview).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('AI models disagreed')])
      );
    });

    it('should skip Gemini verification when disabled', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { extractSetNumbersWithGemini } = await import(
        '../../ai/gemini-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [],
          overallNotes: '',
          analysisConfidence: 0,
          warnings: [],
        })
        .mockResolvedValueOnce({ verifications: [] });

      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        items: [],
      });

      const { analyzePhotos } = await import('../photo-analysis.service');

      await analyzePhotos([{ base64: 'data', mediaType: 'image/jpeg' }], {
        useGeminiVerification: false,
        useBrickognize: true,
      });

      expect(extractSetNumbersWithGemini).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // analyzePhotos - Brickognize integration
  // ===========================================================================

  describe('Brickognize integration', () => {
    it('should enhance minifig items with Brickognize matches', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { identifyAllItemsFromImages, getMinifigMatches } = await import(
        '../../brickognize/client'
      );

      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [
            {
              itemType: 'minifig',
              setNumber: null,
              setName: null,
              condition: 'Used',
              boxCondition: null,
              sealStatus: 'Unknown',
              damageNotes: [],
              confidenceScore: 0.7,
              needsReview: false,
              reviewReason: null,
              rawDescription: 'Star Wars minifig',
              quantity: 1,
              minifigDescription: 'Luke Skywalker',
            },
          ],
          overallNotes: '',
          analysisConfidence: 0.7,
          warnings: [],
        })
        .mockResolvedValueOnce({ verifications: [] });

      const mockBrickognizeItems = [
        {
          type: 'minifig',
          id: 'sw0001',
          name: 'Luke Skywalker',
          confidence: 0.85,
          externalIds: { bricklink: 'sw0001' },
        },
      ];

      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        items: mockBrickognizeItems,
      });

      (getMinifigMatches as ReturnType<typeof vi.fn>).mockReturnValue(mockBrickognizeItems);

      const { analyzePhotos } = await import('../photo-analysis.service');

      const result = await analyzePhotos([
        { base64: 'data', mediaType: 'image/jpeg' },
      ]);

      expect(result.items[0].minifigId).toBe('sw0001');
      expect(result.items[0].brickognizeMatches).toBeDefined();
    });

    it('should skip Brickognize when disabled', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [],
          overallNotes: '',
          analysisConfidence: 0,
          warnings: [],
        })
        .mockResolvedValueOnce({ verifications: [] });

      const { analyzePhotos } = await import('../photo-analysis.service');

      await analyzePhotos([{ base64: 'data', mediaType: 'image/jpeg' }], {
        useGeminiVerification: false,
        useBrickognize: false,
      });

      expect(identifyAllItemsFromImages).not.toHaveBeenCalled();
    });

    it('should handle Brickognize errors gracefully', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          items: [
            {
              itemType: 'set',
              setNumber: '75192',
              setName: 'Test',
              condition: 'New',
              boxCondition: 'Good',
              sealStatus: 'Factory Sealed',
              damageNotes: [],
              confidenceScore: 0.9,
              needsReview: false,
              reviewReason: null,
              rawDescription: 'Test',
              quantity: 1,
            },
          ],
          overallNotes: '',
          analysisConfidence: 0.9,
          warnings: [],
        })
        .mockResolvedValueOnce({
          verifications: [
            {
              providedSetNumber: '75192',
              isCorrect: true,
              reason: 'OK',
            },
          ],
        });

      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Brickognize API error')
      );

      const { analyzePhotos } = await import('../photo-analysis.service');

      // Should not throw - error is handled gracefully
      const result = await analyzePhotos([
        { base64: 'data', mediaType: 'image/jpeg' },
      ]);

      expect(result.items).toHaveLength(1);
    });
  });

  // ===========================================================================
  // analyzePhotos - Error handling
  // ===========================================================================

  describe('error handling', () => {
    it('should throw error when primary analysis fails', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );

      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Claude API unavailable')
      );

      const { analyzePhotos } = await import('../photo-analysis.service');

      await expect(
        analyzePhotos([{ base64: 'data', mediaType: 'image/jpeg' }])
      ).rejects.toThrow('Claude Opus analysis failed');
    });

    it('should throw error when Gemini primary fails and is required', async () => {
      const { isGeminiConfigured, analyzePhotosWithGemini } = await import(
        '../../ai/gemini-client'
      );

      (isGeminiConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (analyzePhotosWithGemini as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Gemini API error')
      );

      const { analyzePhotos } = await import('../photo-analysis.service');

      await expect(
        analyzePhotos([{ base64: 'data', mediaType: 'image/jpeg' }], {
          primaryModel: 'gemini',
          useGeminiVerification: false,
          useBrickognize: false,
        })
      ).rejects.toThrow();
    });

    it('should throw error when Gemini is primary but not configured', async () => {
      const { isGeminiConfigured } = await import('../../ai/gemini-client');

      (isGeminiConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const { analyzePhotos } = await import('../photo-analysis.service');

      await expect(
        analyzePhotos([{ base64: 'data', mediaType: 'image/jpeg' }], {
          primaryModel: 'gemini',
          useGeminiVerification: false,
          useBrickognize: false,
        })
      ).rejects.toThrow('Gemini is configured as primary model but GOOGLE_AI_API_KEY is not set');
    });

    it('should continue analysis when verification fails', async () => {
      const { sendMessageWithImagesForJSON } = await import(
        '../../ai/claude-client'
      );
      const { identifyAllItemsFromImages } = await import(
        '../../brickognize/client'
      );

      let callCount = 0;
      (sendMessageWithImagesForJSON as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Primary analysis succeeds
          return Promise.resolve({
            items: [
              {
                itemType: 'set',
                setNumber: '75192',
                setName: 'Test',
                condition: 'New',
                boxCondition: 'Good',
                sealStatus: 'Factory Sealed',
                damageNotes: [],
                confidenceScore: 0.9,
                needsReview: false,
                reviewReason: null,
                rawDescription: 'Test',
                quantity: 1,
              },
            ],
            overallNotes: '',
            analysisConfidence: 0.9,
            warnings: [],
          });
        }
        // Verification call fails
        return Promise.reject(new Error('Verification API error'));
      });

      (identifyAllItemsFromImages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        items: [],
      });

      const { analyzePhotos } = await import('../photo-analysis.service');

      // Should not throw - verification failure is handled gracefully
      const result = await analyzePhotos([
        { base64: 'data', mediaType: 'image/jpeg' },
      ]);

      expect(result.items).toHaveLength(1);
    });
  });

  // ===========================================================================
  // isGeminiConfigured export
  // ===========================================================================

  describe('isGeminiConfigured export', () => {
    it('should re-export isGeminiConfigured from gemini-client', async () => {
      const serviceModule = await import('../photo-analysis.service');

      expect(serviceModule).toHaveProperty('isGeminiConfigured');
      expect(typeof serviceModule.isGeminiConfigured).toBe('function');
    });
  });
});




