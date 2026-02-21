import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a mock that we can control from tests
const mockCreate = vi.fn();

// Mock the Anthropic SDK with a proper class constructor
vi.mock('@anthropic-ai/sdk', () => {
  // Create a mock class that can be instantiated with `new`
  const MockAnthropic = class {
    messages = {
      create: mockCreate,
    };
  };

  return {
    default: MockAnthropic,
  };
});

// Suppress console logs during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Claude Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-api-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ===========================================================================
  // getClaudeClient
  // ===========================================================================

  describe('getClaudeClient', () => {
    it('should create Anthropic client with API key from environment', async () => {
      const { getClaudeClient } = await import('../claude-client');
      const client = getClaudeClient();

      expect(client).toBeDefined();
      expect(client.messages).toBeDefined();
    });

    it('should return singleton instance', async () => {
      const { getClaudeClient } = await import('../claude-client');

      const client1 = getClaudeClient();
      const client2 = getClaudeClient();

      expect(client1).toBe(client2);
    });
  });

  // ===========================================================================
  // sendMessage
  // ===========================================================================

  describe('sendMessage', () => {
    const mockTextResponse = {
      content: [
        {
          type: 'text',
          text: 'Hello, this is the response!',
        },
      ],
    };

    it('should send message and return text response', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessage } = await import('../claude-client');

      const result = await sendMessage('You are helpful.', 'Hello!');

      expect(result).toBe('Hello, this is the response!');
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello!' }],
      });
    });

    it('should use custom model when specified', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessage } = await import('../claude-client');

      await sendMessage('System', 'User', { model: 'claude-opus-4-20250514' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
        })
      );
    });

    it('should use custom maxTokens when specified', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessage } = await import('../claude-client');

      await sendMessage('System', 'User', { maxTokens: 4096 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
        })
      );
    });

    it('should use custom temperature when specified', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessage } = await import('../claude-client');

      await sendMessage('System', 'User', { temperature: 0.7 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        })
      );
    });

    it('should throw error when no text block in response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
      });

      const { sendMessage } = await import('../claude-client');

      await expect(sendMessage('System', 'User')).rejects.toThrow('No text response from Claude');
    });

    it('should throw error when content is empty', async () => {
      mockCreate.mockResolvedValueOnce({ content: [] });

      const { sendMessage } = await import('../claude-client');

      await expect(sendMessage('System', 'User')).rejects.toThrow('No text response from Claude');
    });
  });

  // ===========================================================================
  // sendMessageWithImage
  // ===========================================================================

  describe('sendMessageWithImage', () => {
    const mockTextResponse = {
      content: [{ type: 'text', text: 'Image analysis result' }],
    };

    it('should send message with single image', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessageWithImage } = await import('../claude-client');

      const result = await sendMessageWithImage('Analyze this image.', 'What do you see?', {
        base64: 'iVBORw0KGgoAAAANSUhEU',
        mediaType: 'image/png',
      });

      expect(result).toBe('Image analysis result');
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        system: 'Analyze this image.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgoAAAANSUhEU',
                },
              },
              { type: 'text', text: 'What do you see?' },
            ],
          },
        ],
      });
    });

    it('should support different image media types', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessageWithImage } = await import('../claude-client');

      await sendMessageWithImage('System', 'Message', {
        base64: 'data',
        mediaType: 'image/jpeg',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                expect.objectContaining({
                  source: expect.objectContaining({
                    media_type: 'image/jpeg',
                  }),
                }),
                expect.any(Object),
              ],
            },
          ],
        })
      );
    });

    it('should throw error when no text block in response', async () => {
      mockCreate.mockResolvedValueOnce({ content: [] });

      const { sendMessageWithImage } = await import('../claude-client');

      await expect(
        sendMessageWithImage('System', 'User', {
          base64: 'data',
          mediaType: 'image/png',
        })
      ).rejects.toThrow('No text response from Claude');
    });
  });

  // ===========================================================================
  // sendMessageWithImages
  // ===========================================================================

  describe('sendMessageWithImages', () => {
    const mockTextResponse = {
      content: [{ type: 'text', text: 'Multi-image analysis' }],
    };

    it('should send message with multiple images', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessageWithImages } = await import('../claude-client');

      const images = [
        { base64: 'image1data', mediaType: 'image/jpeg' as const },
        { base64: 'image2data', mediaType: 'image/png' as const },
      ];

      const result = await sendMessageWithImages('Analyze images.', 'Compare these.', images);

      expect(result).toBe('Multi-image analysis');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2048, // Default for multi-image
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: 'image1data',
                  },
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'image2data',
                  },
                },
                { type: 'text', text: 'Compare these.' },
              ],
            },
          ],
        })
      );
    });

    it('should handle single image in array', async () => {
      mockCreate.mockResolvedValueOnce(mockTextResponse);

      const { sendMessageWithImages } = await import('../claude-client');

      await sendMessageWithImages('System', 'Message', [
        { base64: 'data', mediaType: 'image/gif' },
      ]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                expect.objectContaining({
                  source: expect.objectContaining({
                    media_type: 'image/gif',
                  }),
                }),
                expect.any(Object),
              ],
            },
          ],
        })
      );
    });
  });

  // ===========================================================================
  // sendMessageForJSON
  // ===========================================================================

  describe('sendMessageForJSON', () => {
    it('should parse plain JSON response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"key": "value", "number": 42}' }],
      });

      const { sendMessageForJSON } = await import('../claude-client');

      const result = await sendMessageForJSON<{ key: string; number: number }>(
        'Return JSON.',
        'Give me data.'
      );

      expect(result).toEqual({ key: 'value', number: 42 });
    });

    it('should extract JSON from markdown code blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'Here is the result:\n```json\n{"parsed": true}\n```',
          },
        ],
      });

      const { sendMessageForJSON } = await import('../claude-client');

      const result = await sendMessageForJSON<{ parsed: boolean }>('System', 'User');

      expect(result).toEqual({ parsed: true });
    });

    it('should extract JSON from untyped code blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '```\n{"data": [1, 2, 3]}\n```',
          },
        ],
      });

      const { sendMessageForJSON } = await import('../claude-client');

      const result = await sendMessageForJSON<{ data: number[] }>('System', 'User');

      expect(result).toEqual({ data: [1, 2, 3] });
    });

    it('should throw error on invalid JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Not valid JSON' }],
      });

      const { sendMessageForJSON } = await import('../claude-client');

      await expect(sendMessageForJSON('System', 'User')).rejects.toThrow(
        'Failed to parse AI response as JSON'
      );
    });

    it('should throw error on malformed JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"unclosed": "brace"' }],
      });

      const { sendMessageForJSON } = await import('../claude-client');

      await expect(sendMessageForJSON('System', 'User')).rejects.toThrow(
        'Failed to parse AI response as JSON'
      );
    });
  });

  // ===========================================================================
  // sendMessageWithImagesForJSON
  // ===========================================================================

  describe('sendMessageWithImagesForJSON', () => {
    it('should parse JSON from image analysis response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '{"setNumber": "75192", "confidence": 0.95}',
          },
        ],
      });

      const { sendMessageWithImagesForJSON } = await import('../claude-client');

      const result = await sendMessageWithImagesForJSON<{
        setNumber: string;
        confidence: number;
      }>('Analyze image.', 'Extract data.', [{ base64: 'imagedata', mediaType: 'image/jpeg' }]);

      expect(result).toEqual({ setNumber: '75192', confidence: 0.95 });
    });

    it('should extract JSON from markdown in image response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'Analysis complete:\n```json\n{"items": ["a", "b"]}\n```',
          },
        ],
      });

      const { sendMessageWithImagesForJSON } = await import('../claude-client');

      const result = await sendMessageWithImagesForJSON<{ items: string[] }>('System', 'Message', [
        { base64: 'data', mediaType: 'image/png' },
      ]);

      expect(result).toEqual({ items: ['a', 'b'] });
    });

    it('should throw error on invalid JSON from image analysis', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Could not analyze the image.' }],
      });

      const { sendMessageWithImagesForJSON } = await import('../claude-client');

      await expect(
        sendMessageWithImagesForJSON('System', 'Message', [
          { base64: 'data', mediaType: 'image/png' },
        ])
      ).rejects.toThrow('Failed to parse AI response as JSON');
    });
  });

  // ===========================================================================
  // Type exports
  // ===========================================================================

  describe('type exports', () => {
    it('should export ImageMediaType type', async () => {
      const clientModule = await import('../claude-client');
      // Type checking is done at compile time, but we can verify the module exports
      expect(clientModule).toHaveProperty('sendMessageWithImage');
      expect(clientModule).toHaveProperty('sendMessageWithImages');
    });

    it('should export ImageInput interface', async () => {
      const clientModule = await import('../claude-client');
      expect(clientModule).toHaveProperty('sendMessageWithImagesForJSON');
    });
  });
});
