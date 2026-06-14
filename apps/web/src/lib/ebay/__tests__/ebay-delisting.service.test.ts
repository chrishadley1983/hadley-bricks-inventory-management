/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getAccessToken = vi.fn();
vi.mock('../ebay-auth.service', () => ({
  ebayAuthService: { getAccessToken: (...a: any[]) => getAccessToken(...a) },
}));

import { EbayDelistingService } from '../ebay-delisting.service';

function xmlResponse(body: string) {
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) } as any);
}

const SUCCESS = '<EndFixedPriceItemResponse><Ack>Success</Ack></EndFixedPriceItemResponse>';
const ALREADY_ENDED =
  '<EndFixedPriceItemResponse><Ack>Failure</Ack><Errors><ErrorCode>1047</ErrorCode><ShortMessage>Auction already closed.</ShortMessage></Errors></EndFixedPriceItemResponse>';
const HARD_FAIL =
  '<EndFixedPriceItemResponse><Ack>Failure</Ack><Errors><ErrorCode>931</ErrorCode><ShortMessage>Auth token invalid.</ShortMessage></Errors></EndFixedPriceItemResponse>';

describe('EbayDelistingService.endListing', () => {
  let fetchMock: any;
  beforeEach(() => {
    getAccessToken.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fails when there is no eBay token', async () => {
    getAccessToken.mockResolvedValue(null);
    const svc = new EbayDelistingService({} as any);
    const res = await svc.endListing('user', '123');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no ebay access token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns success on Ack=Success', async () => {
    getAccessToken.mockResolvedValue('tok');
    fetchMock.mockReturnValue(xmlResponse(SUCCESS));
    const svc = new EbayDelistingService({} as any);
    const res = await svc.endListing('user', '178188796525');
    expect(res.success).toBe(true);
    expect(res.listingStatus).toBe('Completed');
    // Verifies the call targets the Trading API with the IAF token + UK site
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-EBAY-API-CALL-NAME']).toBe('EndFixedPriceItem');
    expect(init.headers['X-EBAY-API-SITEID']).toBe('3');
    expect(init.headers['X-EBAY-API-IAF-TOKEN']).toBe('tok');
    expect(init.body).toContain('<ItemID>178188796525</ItemID>');
  });

  it('treats "already ended" (1047) as idempotent success', async () => {
    getAccessToken.mockResolvedValue('tok');
    fetchMock.mockReturnValue(xmlResponse(ALREADY_ENDED));
    const svc = new EbayDelistingService({} as any);
    const res = await svc.endListing('user', '123');
    expect(res.success).toBe(true);
    expect(res.alreadyEnded).toBe(true);
  });

  it('returns failure with the error code on a hard failure', async () => {
    getAccessToken.mockResolvedValue('tok');
    fetchMock.mockReturnValue(xmlResponse(HARD_FAIL));
    const svc = new EbayDelistingService({} as any);
    const res = await svc.endListing('user', '123');
    expect(res.success).toBe(false);
    expect(res.error).toContain('931');
  });
});

describe('EbayDelistingService.endListingForInventoryItem', () => {
  let fetchMock: any;
  beforeEach(() => {
    getAccessToken.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the id-prefix for a SKU-less item and ends a matching listing', async () => {
    getAccessToken.mockResolvedValue('tok');
    fetchMock.mockReturnValue(xmlResponse(SUCCESS));

    const eqCalls: any[][] = [];
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: updateEq }));
    const selectChain: any = {
      eq: vi.fn((...args: any[]) => {
        eqCalls.push(args);
        return selectChain;
      }),
      then: (onF: any) =>
        Promise.resolve({
          data: [{ id: 'pl1', platform_item_id: '999', listing_status: 'Active' }],
        }).then(onF),
    };
    const supabase: any = { from: vi.fn(() => ({ select: vi.fn(() => selectChain), update })) };

    const svc = new EbayDelistingService(supabase);
    const res = await svc.endListingForInventoryItem('user', { id: '3ae82fd0-c91e-1234', sku: null });
    expect(res.found).toBe(true);
    expect(res.ended).toBe(true);
    // matched on the 8-char id prefix, not on a null sku
    expect(eqCalls).toContainEqual(['platform_sku', '3ae82fd0']);
  });

  it('ends an active eBay listing and marks it Completed', async () => {
    getAccessToken.mockResolvedValue('tok');
    fetchMock.mockReturnValue(xmlResponse(SUCCESS));

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: updateEq }));
    // select(...).eq().eq().eq() resolves to the active listing
    const selectChain: any = {
      eq: vi.fn(() => selectChain),
      then: (onF: any) =>
        Promise.resolve({
          data: [{ id: 'pl1', platform_item_id: '178188796525', listing_status: 'Active' }],
        }).then(onF),
    };
    const supabase: any = {
      from: vi.fn(() => ({ select: vi.fn(() => selectChain), update })),
    };

    const svc = new EbayDelistingService(supabase);
    const res = await svc.endListingForInventoryItem('user', { id: 'inv1', sku: 'Garage - E1-6474' });
    expect(res.found).toBe(true);
    expect(res.ended).toBe(true);
    expect(res.ebayItemId).toBe('178188796525');
    expect(update).toHaveBeenCalledWith({ listing_status: 'Completed' });
  });

  it('reports not-found when there is no active listing for the SKU', async () => {
    const selectChain: any = {
      eq: vi.fn(() => selectChain),
      then: (onF: any) => Promise.resolve({ data: [] }).then(onF),
    };
    const supabase: any = { from: vi.fn(() => ({ select: vi.fn(() => selectChain) })) };
    const svc = new EbayDelistingService(supabase);
    const res = await svc.endListingForInventoryItem('user', { id: 'inv1', sku: 'NOPE' });
    expect(res.found).toBe(false);
    expect(res.ended).toBe(false);
  });
});
