import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrickOwlTransactionSyncService } from '../brickowl-transaction-sync.service';
import type { BrickOwlOrderDetail } from '../types';

// Mock the OrderRepository so we can spy on upsertMany without hitting the DB
const mockUpsertMany = vi.fn();
vi.mock('@/lib/repositories', async () => {
  const actual = await vi.importActual<typeof import('@/lib/repositories')>(
    '@/lib/repositories'
  );
  class MockOrderRepository {
    upsertMany = mockUpsertMany;
  }
  return {
    ...actual,
    OrderRepository: MockOrderRepository,
  };
});

interface ChainableMock {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
}

function makeSupabaseMock(): ChainableMock {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  } as unknown as ChainableMock;
  // For the existing-order-IDs query: select('brickowl_order_id').eq().in()
  // returns { data: [] } (treat all orders as new)
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockResolvedValue({ data: [], error: null });
  chain.from = vi.fn().mockReturnValue(chain);
  return chain;
}

function makeOrder(overrides: Partial<BrickOwlOrderDetail> = {}): BrickOwlOrderDetail {
  return {
    order_id: '12345',
    iso_order_time: '2026-04-30T10:00:00Z',
    buyer_name: 'Test Buyer',
    buyer_email: 'buyer@example.com',
    status: 'Payment Received',
    tracking_number: null,
    payment_status: 'paid',
    payment_method_text: 'PayPal',
    currency: 'GBP',
    // BO API uses these field names — see transformOrderToPlatformOrder
    sub_total: '20.00',
    ship_total: '5.00',
    tax_amount: '1.00',
    payment_total: '26.00',
    base_currency: 'GBP',
    customer_email: 'buyer@example.com',
    total_quantity: '3',
    total_lots: '1',
    ...overrides,
  } as unknown as BrickOwlOrderDetail;
}

describe('BrickOwlTransactionSyncService dual-write', () => {
  let service: BrickOwlTransactionSyncService;
  let supabase: ChainableMock;

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = makeSupabaseMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new BrickOwlTransactionSyncService(supabase as any);
    mockUpsertMany.mockResolvedValue([]);
  });

  it('upserts to brickowl_transactions AND platform_orders', async () => {
    const order = makeOrder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).upsertTransactions('user-1', [order]);

    // brickowl_transactions write happened (the chain.upsert mock)
    expect(supabase.from).toHaveBeenCalledWith('brickowl_transactions');
    expect(supabase.upsert).toHaveBeenCalledTimes(1);

    // platform_orders write happened via OrderRepository.upsertMany
    expect(mockUpsertMany).toHaveBeenCalledTimes(1);
  });

  it('platform_orders row maps the canonical BO fields correctly', async () => {
    const order = makeOrder({
      order_id: '6741623',
      buyer_name: 'Geoff Trewick',
      status: 'Payment Received',
      tracking_number: 'RM123',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).upsertTransactions('user-1', [order]);

    const platformRows = mockUpsertMany.mock.calls[0][0];
    expect(platformRows).toHaveLength(1);
    expect(platformRows[0]).toMatchObject({
      user_id: 'user-1',
      platform: 'brickowl',
      platform_order_id: '6741623',
      buyer_name: 'Geoff Trewick',
      status: 'Payment Received',
      subtotal: 20,
      shipping: 5,
      fees: 1, // BO tax mapped to fees
      total: 26, // payment_total wins over base_order_total
      currency: 'GBP',
      tracking_number: 'RM123',
      items_count: 3,
    });
    expect(platformRows[0].order_date).toBe('2026-04-30T10:00:00Z');
    expect(platformRows[0].raw_data).toBeDefined();
  });

  it('skips orders without a valid date in BOTH writes (lockstep)', async () => {
    const order = makeOrder({
      iso_order_time: undefined,
      order_time: undefined,
    } as unknown as Partial<BrickOwlOrderDetail>);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).upsertTransactions('user-1', [order]);

    // brickowl_transactions: chain.upsert NOT called because rows array is empty
    expect(supabase.upsert).not.toHaveBeenCalled();
    // platform_orders: upsertMany NOT called because platformRows is empty
    expect(mockUpsertMany).not.toHaveBeenCalled();
  });

  it('falls back to base_order_total when payment_total is missing', async () => {
    const order = makeOrder({
      payment_total: undefined,
      base_order_total: '99.99',
    } as unknown as Partial<BrickOwlOrderDetail>);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).upsertTransactions('user-1', [order]);

    const platformRows = mockUpsertMany.mock.calls[0][0];
    expect(platformRows[0].total).toBe(99.99);
  });

  it('batches platform_orders writes at BATCH_SIZE=100', async () => {
    const orders = Array.from({ length: 250 }, (_, i) =>
      makeOrder({ order_id: String(1000 + i) })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).upsertTransactions('user-1', orders);

    expect(mockUpsertMany).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(mockUpsertMany.mock.calls[0][0]).toHaveLength(100);
    expect(mockUpsertMany.mock.calls[1][0]).toHaveLength(100);
    expect(mockUpsertMany.mock.calls[2][0]).toHaveLength(50);
  });
});
