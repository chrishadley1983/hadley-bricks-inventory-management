/**
 * Brickset API v3 Client
 *
 * Low-level API client for the Brickset web service.
 * See: https://brickset.com/article/52664/api-version-3-documentation
 */

import type {
  BricksetSearchParams,
  BricksetApiResponse,
  BricksetApiSet,
  BricksetTheme,
  BricksetUsageStats,
  BricksetKeyCheckResponse,
} from './types';

const BRICKSET_API_BASE = 'https://brickset.com/api/v3.asmx';

export class BricksetApiError extends Error {
  constructor(
    message: string,
    public status?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'BricksetApiError';
  }
}

export class BricksetApiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Brickset API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Make a POST request to the Brickset API
   */
  private async request<T>(method: string, params: Record<string, string> = {}): Promise<T> {
    const url = `${BRICKSET_API_BASE}/${method}`;

    const formData = new URLSearchParams();
    formData.append('apiKey', this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      // userHash must always be included (even if empty) for getSets
      if (key === 'userHash' || (value !== undefined && value !== null && value !== '')) {
        formData.append(key, value);
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new BricksetApiError(
        `HTTP error: ${response.status} ${response.statusText}`,
        'HTTP_ERROR',
        response.status
      );
    }

    const data = await response.json();

    // Check for API-level errors
    if (data.status === 'error') {
      throw new BricksetApiError(data.message || 'Unknown API error', data.status);
    }

    return data;
  }

  /**
   * Check if the API key is valid
   */
  async checkKey(): Promise<boolean> {
    try {
      const response = await this.request<BricksetKeyCheckResponse>('checkKey');
      return response.status === 'success';
    } catch (error) {
      if (error instanceof BricksetApiError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get sets based on search parameters
   */
  async getSets(params: BricksetSearchParams = {}): Promise<BricksetApiResponse<BricksetApiSet[]>> {
    // Build the params JSON string as required by the API
    const searchParams: Record<string, unknown> = {};

    if (params.setID) searchParams.setID = params.setID;
    if (params.query) searchParams.query = params.query;
    if (params.theme) searchParams.theme = params.theme;
    if (params.subtheme) searchParams.subtheme = params.subtheme;
    if (params.setNumber) searchParams.setNumber = params.setNumber;
    if (params.year) searchParams.year = params.year;
    if (params.tag) searchParams.tag = params.tag;
    if (params.updatedSince) searchParams.updatedSince = params.updatedSince;
    if (params.orderBy) searchParams.orderBy = params.orderBy;

    const requestParams: Record<string, string> = {
      // userHash is required by the API (even if empty)
      userHash: '',
      params: JSON.stringify(searchParams),
    };

    if (params.pageNumber) {
      requestParams.pageNumber = params.pageNumber.toString();
    }
    if (params.pageSize) {
      requestParams.pageSize = Math.min(params.pageSize, 500).toString();
    }
    if (params.extendedData) {
      requestParams.extendedData = '1';
    }

    const response = await this.request<BricksetApiResponse<BricksetApiSet[]>>('getSets', requestParams);

    return {
      status: response.status,
      message: response.message,
      matches: response.matches,
      sets: response.sets || [],
    };
  }

  /**
   * Get a single set by set number (e.g., "75192-1")
   */
  async getSetByNumber(setNumber: string): Promise<BricksetApiSet | null> {
    const response = await this.getSets({
      setNumber,
      pageSize: 1,
      extendedData: true,
    });

    return response.sets && response.sets.length > 0 ? response.sets[0] : null;
  }

  /**
   * Search sets by query string
   */
  async searchSets(
    query: string,
    options: Partial<BricksetSearchParams> = {}
  ): Promise<BricksetApiSet[]> {
    const response = await this.getSets({
      query,
      pageSize: options.pageSize || 100,
      ...options,
    });

    return response.sets || [];
  }

  /**
   * Get all themes
   */
  async getThemes(): Promise<BricksetTheme[]> {
    const response = await this.request<BricksetApiResponse<BricksetTheme[]>>('getThemes');
    return response.themes || [];
  }

  /**
   * Get subthemes for a specific theme
   */
  async getSubthemes(theme: string): Promise<{ subtheme: string; setCount: number; yearFrom: number; yearTo: number }[]> {
    const response = await this.request<{
      status: string;
      subthemes?: { subtheme: string; setCount: number; yearFrom: number; yearTo: number }[];
    }>('getSubthemes', { theme });

    return response.subthemes || [];
  }

  /**
   * Get years for a specific theme
   */
  async getYears(theme: string): Promise<{ year: string; setCount: number }[]> {
    const response = await this.request<{
      status: string;
      years?: { year: string; setCount: number }[];
    }>('getYears', { theme });

    return response.years || [];
  }

  /**
   * Get API key usage statistics
   */
  async getKeyUsageStats(): Promise<BricksetUsageStats[]> {
    const response = await this.request<{
      status: string;
      apiKeyUsage?: BricksetUsageStats[];
    }>('getKeyUsageStats');

    return response.apiKeyUsage || [];
  }

  /**
   * Get additional images for a set
   */
  async getAdditionalImages(setID: number): Promise<{ thumbnailURL: string; imageURL: string }[]> {
    const response = await this.request<{
      status: string;
      additionalImages?: { thumbnailURL: string; imageURL: string }[];
    }>('getAdditionalImages', { setID: setID.toString() });

    return response.additionalImages || [];
  }

  /**
   * Get instructions for a set
   */
  async getInstructions(setID: number): Promise<{ URL: string; description: string }[]> {
    const response = await this.request<{
      status: string;
      instructions?: { URL: string; description: string }[];
    }>('getInstructions', { setID: setID.toString() });

    return response.instructions || [];
  }
}
