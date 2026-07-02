/**
 * QuickFile API service tests — authentication header construction (MD5,
 * ApplicationID from credentials) and connection testing against the real
 * client/search endpoint shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { QuickFileService } from '../quickfile.service';

const credentials = {
  accountNumber: '7131412142',
  apiKey: 'TEST-KEY-1234',
  applicationId: '6e0bb58b-f8a3-4200-a00b-e7f4e3ccffc1',
};

describe('QuickFileService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function okResponse(body: unknown) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
    };
  }

  it('sends the App ID from credentials and a valid MD5(acc+key+submission)', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ Client_Search: { Header: { MessageType: 'Response' }, Body: {} } })
    );

    const service = new QuickFileService(credentials);
    const ok = await service.testConnection();
    expect(ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.quickfile.co.uk/1_2/client/search');

    const payload = JSON.parse((init as { body: string }).body);
    const header = payload.payload.Header;
    expect(header.Authentication.AccNumber).toBe(credentials.accountNumber);
    expect(header.Authentication.ApplicationID).toBe(credentials.applicationId);

    const expectedMd5 = crypto
      .createHash('md5')
      .update(`${credentials.accountNumber}${credentials.apiKey}${header.SubmissionNumber}`)
      .digest('hex');
    expect(header.Authentication.MD5Value).toBe(expectedMd5);
  });

  it('falls back to the legacy ApplicationID when credentials lack one', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ Client_Search: { Header: { MessageType: 'Response' }, Body: {} } })
    );

    const service = new QuickFileService({
      accountNumber: credentials.accountNumber,
      apiKey: credentials.apiKey,
    });
    await service.testConnection();

    const payload = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(payload.payload.Header.Authentication.ApplicationID).toBe('hadley-bricks-mtd');
  });

  it('uses a unique submission number per request', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ Client_Search: { Header: { MessageType: 'Response' }, Body: {} } })
    );

    const service = new QuickFileService(credentials);
    await service.testConnection();
    await service.testConnection();

    const sub1 = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).payload.Header
      .SubmissionNumber;
    const sub2 = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body).payload.Header
      .SubmissionNumber;
    expect(sub1).not.toBe(sub2);
  });

  it('returns false when the API rejects the request (Errors array shape)', async () => {
    fetchMock.mockResolvedValue(okResponse({ Errors: { Error: ['Authentication failed'] } }));

    const service = new QuickFileService(credentials);
    const ok = await service.testConnection();
    expect(ok).toBe(false);
  });

  it('returns false on HTTP-level failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    const service = new QuickFileService(credentials);
    const ok = await service.testConnection();
    expect(ok).toBe(false);
  });

  it('createSalesInvoice posts to invoice/create with nominal code and issue date', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        Invoice_Create: { Header: { MessageType: 'Response' }, Body: { InvoiceID: 42 } },
      })
    );

    const service = new QuickFileService(credentials);
    const result = await service.createSalesInvoice({
      date: '2026-06-30',
      reference: 'AMAZON-202606',
      description: 'Amazon Sales - June 2026',
      netAmount: 1927.82,
      vat: 0,
      grossAmount: 1927.82,
      nominalCode: '4000',
    });

    expect(result).toEqual({ success: true, invoiceId: 42 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.quickfile.co.uk/1_2/invoice/create');
    const body = JSON.parse((init as { body: string }).body).payload.Body;
    expect(body.InvoiceData.InvoiceLines[0].ItemNominalCode).toBe('4000');
    expect(body.InvoiceData.InvoiceLines[0].UnitCost).toBe(1927.82);
    expect(body.InvoiceData.Scheduling.SingleInvoiceData.IssueDate).toBe('2026-06-30');
  });

  it('pushMtdData reports per-row errors without aborting the batch', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          Invoice_Create: { Header: { MessageType: 'Response' }, Body: { InvoiceID: 1 } },
        })
      )
      .mockResolvedValueOnce(okResponse({ Errors: { Error: ['Nominal code invalid'] } }))
      .mockResolvedValueOnce(
        okResponse({
          Purchase_Create: { Header: { MessageType: 'Response' }, Body: { PurchaseID: 7 } },
        })
      );

    const service = new QuickFileService(credentials);
    const salesRow = {
      date: '2026-06-30',
      reference: 'A',
      description: 'a',
      netAmount: 1,
      vat: 0,
      grossAmount: 1,
      nominalCode: '4000',
    };
    const expenseRow = {
      date: '2026-06-30',
      reference: 'B',
      supplier: 'Various',
      description: 'b',
      netAmount: 2,
      vat: 0,
      grossAmount: 2,
      nominalCode: '5000',
    };

    const result = await service.pushMtdData([salesRow, { ...salesRow, reference: 'A2' }], [expenseRow]);

    expect(result.invoicesCreated).toBe(1);
    expect(result.purchasesCreated).toBe(1);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('A2');
  });
});
