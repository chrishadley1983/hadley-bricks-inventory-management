/**
 * Regression tests for the Bricqer order -> minifig matcher.
 *
 * A Bricqer order line's `id` is the ORDER-LINE id, a DIFFERENT namespace from
 * `minifig_sync_items.bricqer_item_id` (an inventory-item id). Matching on it
 * invented sales: order 1198 line id 8652 was a 6p "Plate, Round 2x2", which
 * marked Gollum (bricqer_item_id 8652) SOLD. 5 of 18 removals were phantoms.
 *
 * Identity must come from bricklink_id; the numeric id is only a tie-breaker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAllOrders, getOrderItems, send, fetchAllRecords, upsert, upsertSelect } = vi.hoisted(
  () => ({
    getAllOrders: vi.fn(),
    getOrderItems: vi.fn(),
    send: vi.fn(),
    fetchAllRecords: vi.fn(),
    upsert: vi.fn(),
    upsertSelect: vi.fn(),
  })
);

vi.mock('../../ebay/ebay-auth.service', () => ({
  EbayAuthService: class {
    getAccessToken = vi.fn().mockResolvedValue('test-token');
  },
}));
vi.mock('../../ebay/ebay-api.adapter', () => ({ EbayApiAdapter: class {} }));
vi.mock('../../bricqer/client', () => ({
  BricqerClient: class {
    getAllOrders = getAllOrders;
    getOrderItems = getOrderItems;
  },
}));
vi.mock('../../repositories/credentials.repository', () => ({
  CredentialsRepository: class {
    getCredentials = vi.fn().mockResolvedValue({ apiKey: 'k', tenantUrl: 'https://t' });
  },
}));
vi.mock('../../notifications/discord.service', () => ({
  discordService: { send },
  DiscordColors: { GREEN: 1 },
}));
vi.mock('../../supabase/pagination', () => ({
  fetchAllRecords: (...args: unknown[]) => fetchAllRecords(...args),
}));
vi.mock('../job-tracker', () => ({
  MinifigJobTracker: class {
    start = vi.fn().mockResolvedValue('job-1');
    getLatestCursor = vi.fn().mockResolvedValue('2026-07-01T00:00:00Z');
    updateCursor = vi.fn().mockResolvedValue(undefined);
    complete = vi.fn().mockResolvedValue(undefined);
    fail = vi.fn().mockResolvedValue(undefined);
  },
}));

import { OrderPollService } from '../order-poll.service';

/** Gollum: the fig whose bricqer_item_id collides with an unrelated order line. */
const GOLLUM = {
  id: 'sync-gollum',
  bricqer_item_id: '8652',
  bricklink_id: 'lor031',
  listing_status: 'PUBLISHED',
  ebay_offer_id: 'offer-gollum',
  name: 'Gollum - Narrow Eyes',
};

function makeSupabase() {
  // upsert(...).select(...) -> { data }
  upsertSelect.mockResolvedValue({ data: [{ id: 'removal-1' }] });
  upsert.mockReturnValue({ select: upsertSelect });
  return {
    from: vi.fn().mockReturnValue({
      upsert,
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
    }),
  } as never;
}

describe('pollBricqerOrders — minifig matching', () => {
  let service: OrderPollService;

  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({ success: true });
    getAllOrders.mockResolvedValue([{ id: 1198, created: '2026-07-24T21:07:39Z' }]);
    fetchAllRecords.mockResolvedValue([GOLLUM]);
    service = new OrderPollService(makeSupabase(), 'user-1');
  });

  it('does NOT invent a sale when an order-line id collides with a bricqer_item_id', async () => {
    // The real order 1198: line id 8652 is a 6p plate, not the Gollum.
    getOrderItems.mockResolvedValue([
      { id: 8652, bricklink_id: '4032', name: 'Plate, Round 2 x 2 with Axle Hole', price: 0.063 },
    ]);

    const result = await service.pollBricqerOrders();

    expect(result.salesDetected).toBe(0);
    expect(result.removalEntriesCreated).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('detects a genuine sale when the line really is that minifig', async () => {
    getOrderItems.mockResolvedValue([
      { id: 9999, bricklink_id: 'lor031', name: 'Gollum - Narrow Eyes', price: 4.5 },
    ]);

    const result = await service.pollBricqerOrders();

    expect(result.salesDetected).toBe(1);
    expect(result.removalEntriesCreated).toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        minifig_sync_id: 'sync-gollum',
        sold_on: 'BRICQER',
        remove_from: 'EBAY',
        sale_price: 4.5,
        order_id: '1198',
      }),
      expect.anything()
    );
  });

  it('ignores lines with no bricklink_id rather than guessing from the numeric id', async () => {
    getOrderItems.mockResolvedValue([{ id: 8652, price: 0.063 }]);

    const result = await service.pollBricqerOrders();

    expect(result.salesDetected).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('uses inventory_item_id as a tie-breaker only when it agrees on bricklink_id', async () => {
    const dupA = { ...GOLLUM, id: 'sync-a', bricqer_item_id: '111' };
    const dupB = { ...GOLLUM, id: 'sync-b', bricqer_item_id: '222' };
    fetchAllRecords.mockResolvedValue([dupA, dupB]);
    // Bricqer DOES supply inventory_item_id here, pointing at the second unit.
    getOrderItems.mockResolvedValue([
      { id: 55, inventory_item_id: 222, bricklink_id: 'lor031', price: 4.5 },
    ]);

    await service.pollBricqerOrders();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ minifig_sync_id: 'sync-b' }),
      expect.anything()
    );
  });

  it('falls back to the first same-fig candidate when inventory_item_id disagrees', async () => {
    const other = {
      ...GOLLUM,
      id: 'sync-other',
      bricqer_item_id: '333',
      bricklink_id: 'sw0603',
    };
    fetchAllRecords.mockResolvedValue([GOLLUM, other]);
    // inventory_item_id 333 resolves to a DIFFERENT fig — must not be honoured.
    getOrderItems.mockResolvedValue([
      { id: 77, inventory_item_id: 333, bricklink_id: 'lor031', price: 4.5 },
    ]);

    await service.pollBricqerOrders();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ minifig_sync_id: 'sync-gollum' }),
      expect.anything()
    );
  });
});
