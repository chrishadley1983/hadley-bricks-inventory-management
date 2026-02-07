/**
 * Rebrickable API v3 Client
 *
 * Fetches LEGO set data, themes, and minifig counts from the Rebrickable REST API.
 * Used by the investment predictor to populate the brickset_sets table with comprehensive
 * set metadata.
 *
 * @see https://rebrickable.com/api/v3/docs/
 */

import type {
  RebrickablePaginatedResponse,
  RebrickableSet,
  RebrickableSetMinifig,
  RebrickableSetSearchParams,
  RebrickableTheme,
} from './types';

const BASE_URL = 'https://rebrickable.com/api/v3';

export class RebrickableApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string
  ) {
    super(message);
    this.name = 'RebrickableApiError';
  }
}

export class RebrickableApiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Rebrickable API key is required');
    }
    this.apiKey = apiKey;
  }

  /** Make an authenticated request to the Rebrickable API */
  private async request<T>(
    path: string,
    params?: Record<string, string | number | undefined>
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `key ${this.apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new RebrickableApiError(
        `Rebrickable API error: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText
      );
    }

    return response.json() as Promise<T>;
  }

  /** Fetch a single page of sets */
  async getSets(
    params?: RebrickableSetSearchParams
  ): Promise<RebrickablePaginatedResponse<RebrickableSet>> {
    return this.request<RebrickablePaginatedResponse<RebrickableSet>>(
      '/lego/sets/',
      params as Record<string, string | number | undefined>
    );
  }

  /**
   * Fetch ALL sets across all pages with rate limiting.
   * Yields pages as they are fetched for streaming processing.
   */
  async *getAllSetsPaginated(
    params?: Omit<RebrickableSetSearchParams, 'page' | 'page_size'>
  ): AsyncGenerator<RebrickableSet[], void, unknown> {
    const pageSize = 1000; // Maximum allowed
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getSets({
        ...params,
        page,
        page_size: pageSize,
      });

      yield response.results;

      hasMore = response.next !== null;
      page++;

      // Respect rate limit: ~1 req/sec
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
    }
  }

  /** Fetch all themes (typically fits in one page) */
  async getThemes(): Promise<RebrickableTheme[]> {
    const response = await this.request<
      RebrickablePaginatedResponse<RebrickableTheme>
    >('/lego/themes/', { page_size: 1000 });

    // Themes usually fit in one page, but handle pagination just in case
    const allThemes = [...response.results];
    let nextUrl = response.next;

    while (nextUrl) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const nextResponse = await fetch(nextUrl, {
        headers: {
          Authorization: `key ${this.apiKey}`,
          Accept: 'application/json',
        },
      });
      const nextData =
        (await nextResponse.json()) as RebrickablePaginatedResponse<RebrickableTheme>;
      allThemes.push(...nextData.results);
      nextUrl = nextData.next;
    }

    return allThemes;
  }

  /** Fetch minifig count for a specific set */
  async getSetMinifigs(
    setNum: string
  ): Promise<RebrickableSetMinifig[]> {
    const response = await this.request<
      RebrickablePaginatedResponse<RebrickableSetMinifig>
    >(`/lego/sets/${encodeURIComponent(setNum)}/minifigs/`, {
      page_size: 1000,
    });
    return response.results;
  }

  /** Get a single set by set number */
  async getSet(setNum: string): Promise<RebrickableSet> {
    return this.request<RebrickableSet>(
      `/lego/sets/${encodeURIComponent(setNum)}/`
    );
  }

  /** Check if the API key is valid */
  async checkKey(): Promise<boolean> {
    try {
      await this.getSets({ page_size: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
