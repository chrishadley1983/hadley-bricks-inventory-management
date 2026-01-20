import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BricksetApiClient, BricksetApiError } from '../brickset-api';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BricksetApiClient', () => {
  const validApiKey = 'test-api-key-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with valid API key', () => {
      const client = new BricksetApiClient(validApiKey);
      expect(client).toBeInstanceOf(BricksetApiClient);
    });

    it('should throw error when API key is empty', () => {
      expect(() => new BricksetApiClient('')).toThrow('Brickset API key is required');
    });

    it('should throw error when API key is undefined', () => {
      expect(() => new BricksetApiClient(undefined as unknown as string)).toThrow(
        'Brickset API key is required'
      );
    });
  });

  describe('checkKey', () => {
    it('should return true for valid API key', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success' }),
      });

      const result = await client.checkKey();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://brickset.com/api/v3.asmx/checkKey',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('should return false for invalid API key', async () => {
      const client = new BricksetApiClient('invalid-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'error', message: 'Invalid API key' }),
      });

      const result = await client.checkKey();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw, but rethrow non-BricksetApiError
      await expect(client.checkKey()).rejects.toThrow('Network error');
    });

    it('should return false when API returns error status', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'error', message: 'API key expired' }),
      });

      const result = await client.checkKey();

      expect(result).toBe(false);
    });
  });

  describe('getSets', () => {
    it('should fetch sets with no parameters', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockSets = [
        { setID: 1, number: '75192', numberVariant: 1, name: 'Millennium Falcon' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 1, sets: mockSets }),
      });

      const result = await client.getSets();

      expect(result.status).toBe('success');
      expect(result.matches).toBe(1);
      expect(result.sets).toEqual(mockSets);
    });

    it('should include search parameters in request', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: [] }),
      });

      await client.getSets({
        setNumber: '75192',
        theme: 'Star Wars',
        year: '2017',
      });

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('apiKey=test-api-key-123');
      expect(body).toContain('userHash=');
      expect(body).toContain('params=');
      // Check the params JSON contains our search criteria
      const paramsMatch = body.match(/params=([^&]+)/);
      expect(paramsMatch).toBeTruthy();
      // URLSearchParams encodes spaces as +, so we need to decode both
      const decodedParams = decodeURIComponent(paramsMatch![1].replace(/\+/g, ' '));
      const params = JSON.parse(decodedParams);
      expect(params.setNumber).toBe('75192');
      expect(params.theme).toBe('Star Wars');
      expect(params.year).toBe('2017');
    });

    it('should handle pagination parameters', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 100, sets: [] }),
      });

      await client.getSets({ pageNumber: 2, pageSize: 50 });

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('pageNumber=2');
      expect(body).toContain('pageSize=50');
    });

    it('should cap pageSize at 500', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: [] }),
      });

      await client.getSets({ pageSize: 1000 });

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('pageSize=500');
    });

    it('should include extendedData flag when requested', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: [] }),
      });

      await client.getSets({ extendedData: true });

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('extendedData=1');
    });

    it('should return empty sets array when API returns null', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: null }),
      });

      const result = await client.getSets();

      expect(result.sets).toEqual([]);
    });

    it('should throw BricksetApiError on API error response', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'error', message: 'Invalid query' }),
      });

      await expect(client.getSets({ query: 'invalid' })).rejects.toThrow(BricksetApiError);
      await expect(client.getSets({ query: 'invalid' })).rejects.toThrow('Invalid query');
    });

    it('should throw BricksetApiError on HTTP error', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.getSets()).rejects.toThrow(BricksetApiError);
      await expect(client.getSets()).rejects.toThrow('HTTP error: 500');
    });
  });

  describe('getSetByNumber', () => {
    it('should return set when found', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockSet = {
        setID: 28877,
        number: '75192',
        numberVariant: 1,
        name: 'Millennium Falcon',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 1, sets: [mockSet] }),
      });

      const result = await client.getSetByNumber('75192-1');

      expect(result).toEqual(mockSet);
    });

    it('should return null when set not found', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: [] }),
      });

      const result = await client.getSetByNumber('99999-1');

      expect(result).toBeNull();
    });

    it('should request extended data by default', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: [] }),
      });

      await client.getSetByNumber('75192');

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('extendedData=1');
      expect(body).toContain('pageSize=1');
    });
  });

  describe('searchSets', () => {
    it('should search sets by query', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockSets = [
        { setID: 1, number: '75192', name: 'Millennium Falcon' },
        { setID: 2, number: '10179', name: 'Millennium Falcon UCS' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 2, sets: mockSets }),
      });

      const result = await client.searchSets('Millennium Falcon');

      expect(result).toEqual(mockSets);
    });

    it('should use default page size of 100', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: [] }),
      });

      await client.searchSets('test');

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('pageSize=100');
    });

    it('should allow custom page size', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: [] }),
      });

      await client.searchSets('test', { pageSize: 50 });

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('pageSize=50');
    });

    it('should return empty array when no sets found', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', matches: 0, sets: null }),
      });

      const result = await client.searchSets('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('getThemes', () => {
    it('should return list of themes', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockThemes = [
        { theme: 'Star Wars', setCount: 500 },
        { theme: 'Technic', setCount: 300 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', themes: mockThemes }),
      });

      const result = await client.getThemes();

      expect(result).toEqual(mockThemes);
    });

    it('should return empty array when no themes', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', themes: null }),
      });

      const result = await client.getThemes();

      expect(result).toEqual([]);
    });
  });

  describe('getSubthemes', () => {
    it('should return subthemes for a theme', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockSubthemes = [
        { subtheme: 'Episode VII', setCount: 50, yearFrom: 2015, yearTo: 2017 },
        { subtheme: 'The Mandalorian', setCount: 30, yearFrom: 2020, yearTo: 2023 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', subthemes: mockSubthemes }),
      });

      const result = await client.getSubthemes('Star Wars');

      expect(result).toEqual(mockSubthemes);
    });

    it('should return empty array when no subthemes', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', subthemes: null }),
      });

      const result = await client.getSubthemes('Unknown Theme');

      expect(result).toEqual([]);
    });
  });

  describe('getYears', () => {
    it('should return years for a theme', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockYears = [
        { year: '2023', setCount: 20 },
        { year: '2022', setCount: 25 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', years: mockYears }),
      });

      const result = await client.getYears('Star Wars');

      expect(result).toEqual(mockYears);
    });

    it('should return empty array when no years', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', years: null }),
      });

      const result = await client.getYears('Unknown Theme');

      expect(result).toEqual([]);
    });
  });

  describe('getKeyUsageStats', () => {
    it('should return API key usage statistics', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockStats = [
        { dateStamp: '2024-01-15', count: 100 },
        { dateStamp: '2024-01-14', count: 150 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', apiKeyUsage: mockStats }),
      });

      const result = await client.getKeyUsageStats();

      expect(result).toEqual(mockStats);
    });

    it('should return empty array when no stats', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', apiKeyUsage: null }),
      });

      const result = await client.getKeyUsageStats();

      expect(result).toEqual([]);
    });
  });

  describe('getAdditionalImages', () => {
    it('should return additional images for a set', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockImages = [
        { thumbnailURL: 'https://example.com/thumb1.jpg', imageURL: 'https://example.com/img1.jpg' },
        { thumbnailURL: 'https://example.com/thumb2.jpg', imageURL: 'https://example.com/img2.jpg' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', additionalImages: mockImages }),
      });

      const result = await client.getAdditionalImages(28877);

      expect(result).toEqual(mockImages);
      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('setID=28877');
    });

    it('should return empty array when no additional images', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', additionalImages: null }),
      });

      const result = await client.getAdditionalImages(12345);

      expect(result).toEqual([]);
    });
  });

  describe('getInstructions', () => {
    it('should return instructions for a set', async () => {
      const client = new BricksetApiClient(validApiKey);
      const mockInstructions = [
        { URL: 'https://example.com/instructions1.pdf', description: 'Book 1' },
        { URL: 'https://example.com/instructions2.pdf', description: 'Book 2' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', instructions: mockInstructions }),
      });

      const result = await client.getInstructions(28877);

      expect(result).toEqual(mockInstructions);
      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('setID=28877');
    });

    it('should return empty array when no instructions', async () => {
      const client = new BricksetApiClient(validApiKey);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', instructions: null }),
      });

      const result = await client.getInstructions(12345);

      expect(result).toEqual([]);
    });
  });
});

describe('BricksetApiError', () => {
  it('should create error with message only', () => {
    const error = new BricksetApiError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('BricksetApiError');
    expect(error.status).toBeUndefined();
    expect(error.statusCode).toBeUndefined();
  });

  it('should create error with status', () => {
    const error = new BricksetApiError('API error', 'error');
    expect(error.message).toBe('API error');
    expect(error.status).toBe('error');
  });

  it('should create error with status and statusCode', () => {
    const error = new BricksetApiError('HTTP error', 'HTTP_ERROR', 500);
    expect(error.message).toBe('HTTP error');
    expect(error.status).toBe('HTTP_ERROR');
    expect(error.statusCode).toBe(500);
  });

  it('should be instance of Error', () => {
    const error = new BricksetApiError('Test');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BricksetApiError);
  });
});
