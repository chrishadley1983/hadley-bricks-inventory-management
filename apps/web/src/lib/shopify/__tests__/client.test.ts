/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShopifyClient } from '../client';

const CONFIG = {
  shop_domain: 'test.myshopify.com',
  client_id: 'cid',
  client_secret: 'secret',
  api_version: '2024-01',
} as any;

function headers(map: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const k of Object.keys(map)) lower[k.toLowerCase()] = map[k];
  return { get: (k: string) => lower[k.toLowerCase()] ?? null };
}

function jsonResponse(body: any, hdrs: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: headers(hdrs),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any;
}

describe('ShopifyClient.getOrders', () => {
  let fetchMock: any;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows the Link header across pages and merges orders', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/oauth/access_token')) {
        return Promise.resolve(jsonResponse({ access_token: 'tok', expires_in: 3600 }));
      }
      if (url.includes('orders.json') && !url.includes('page_info=PAGE2')) {
        return Promise.resolve(
          jsonResponse(
            { orders: [{ id: 1, name: '#1001', line_items: [] }] },
            {
              link: '<https://test.myshopify.com/admin/api/2024-01/orders.json?page_info=PAGE2>; rel="next"',
              'X-Shopify-Shop-Api-Call-Limit': '1/40',
            }
          )
        );
      }
      // page 2 — no next link
      return Promise.resolve(jsonResponse({ orders: [{ id: 2, name: '#1002', line_items: [] }] }));
    });

    const client = new ShopifyClient(CONFIG);
    const orders = await client.getOrders({ updatedAtMin: '2026-06-01T00:00:00Z' });

    expect(orders.map((o) => o.id)).toEqual([1, 2]);
    // token + 2 order pages = 3 fetches
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // the request asks for paid orders by default
    const ordersCall = fetchMock.mock.calls.find((c: any[]) => c[0].includes('orders.json'));
    expect(ordersCall[0]).toContain('financial_status=paid');
    expect(ordersCall[0]).toContain('updated_at_min=');
  });

  it('stops at a single page when there is no next link', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/oauth/access_token')) {
        return Promise.resolve(jsonResponse({ access_token: 'tok', expires_in: 3600 }));
      }
      return Promise.resolve(jsonResponse({ orders: [{ id: 9, name: '#9', line_items: [] }] }));
    });
    const client = new ShopifyClient(CONFIG);
    const orders = await client.getOrders();
    expect(orders).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + 1 page
  });
});

describe('ShopifyClient.findProductsBySku', () => {
  let fetchMock: any;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function productNode(id: string, status: string, sku: string | null) {
    return {
      node: {
        legacyResourceId: id,
        status,
        variants: {
          edges: [
            {
              node: {
                legacyResourceId: `${id}-v`,
                sku,
                inventoryQuantity: 1,
                inventoryItem: { legacyResourceId: `${id}-inv` },
              },
            },
          ],
        },
      },
    };
  }

  it('paginates the tokenized search and keeps only EXACT matches across pages', async () => {
    fetchMock.mockImplementation((url: string, init: any) => {
      if (url.includes('/oauth/access_token')) {
        return Promise.resolve(jsonResponse({ access_token: 'tok', expires_in: 3600 }));
      }
      const after = JSON.parse(init.body).variables.after;
      if (!after) {
        // page 1: only a NEAR match (shares tokens, different SKU) — true match is on page 2
        return Promise.resolve(
          jsonResponse({
            data: {
              products: {
                pageInfo: { hasNextPage: true, endCursor: 'CURSOR1' },
                edges: [productNode('NEAR', 'ACTIVE', 'Garage - EBAY NEW-99999-1')],
              },
            },
          })
        );
      }
      // page 2: the exact match
      return Promise.resolve(
        jsonResponse({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [productNode('EXACT', 'ARCHIVED', 'Garage - EBAY NEW-76990-1')],
            },
          },
        })
      );
    });

    const client = new ShopifyClient(CONFIG);
    const found = await client.findProductsBySku('Garage - EBAY NEW-76990-1');

    // Only the exact SKU match is returned — the near-match on page 1 is dropped.
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ productId: 'EXACT', status: 'ARCHIVED', variantId: 'EXACT-v' });
    // token + 2 graphql pages
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns [] when no product carries the exact SKU', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/oauth/access_token')) {
        return Promise.resolve(jsonResponse({ access_token: 'tok', expires_in: 3600 }));
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [productNode('NEAR', 'ACTIVE', 'DIFFERENT-SKU')],
            },
          },
        })
      );
    });
    const client = new ShopifyClient(CONFIG);
    expect(await client.findProductsBySku('TARGET-SKU')).toEqual([]);
  });
});
