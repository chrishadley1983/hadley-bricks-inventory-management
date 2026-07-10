/**
 * QuickFile API Service
 *
 * Client for the QuickFile accounting software API.
 * Used for MTD (Making Tax Digital) export functionality.
 *
 * API Documentation: https://api.quickfile.co.uk/
 */

import crypto from 'crypto';
import type { QuickFileCredentials, MtdSalesRow, MtdExpenseRow } from '@/types/mtd-export';

/**
 * QuickFile API request header structure
 */
interface QuickFileHeader {
  MessageType: 'Request';
  SubmissionNumber: string;
  Authentication: {
    AccNumber: string;
    MD5Value: string;
    ApplicationID: string;
  };
}

/**
 * QuickFile API response structure
 */
interface QuickFileApiResponse {
  Invoice_Create?: {
    Header: {
      MessageType: string;
    };
    Body?: {
      InvoiceID?: number;
      InvoiceNumber?: string;
    };
  };
  Purchase_Create?: {
    Header: {
      MessageType: string;
    };
    Body?: {
      PurchaseID?: number;
    };
  };
  Client_Search?: {
    Header: {
      MessageType: string;
    };
    Body?: {
      RecordsetCount?: number;
    };
  };
  Error?: {
    Code: string;
    Message: string;
  };
  Errors?: {
    Error: string[];
  };
}

/**
 * QuickFile API service for MTD exports
 */
export class QuickFileService {
  private baseUrl = 'https://api.quickfile.co.uk/1_2';
  private applicationId: string;
  private credentials: QuickFileCredentials;

  constructor(credentials: QuickFileCredentials) {
    this.credentials = credentials;
    // QuickFile requires the App ID GUID of a registered app (Account Settings
    // → My Apps). The legacy literal is kept only as a fallback for stored
    // credentials that predate the applicationId field.
    this.applicationId = credentials.applicationId || 'hadley-bricks-mtd';
  }

  /**
   * Generate MD5 hash for authentication
   */
  private generateMd5(submissionNumber: string): string {
    const stringToHash = `${this.credentials.accountNumber}${this.credentials.apiKey}${submissionNumber}`;
    return crypto.createHash('md5').update(stringToHash).digest('hex');
  }

  /**
   * Generate a unique submission number
   */
  private generateSubmissionNumber(): string {
    return `HB-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Build request header
   */
  private buildHeader(submissionNumber: string): QuickFileHeader {
    return {
      MessageType: 'Request',
      SubmissionNumber: submissionNumber,
      Authentication: {
        AccNumber: this.credentials.accountNumber,
        MD5Value: this.generateMd5(submissionNumber),
        ApplicationID: this.applicationId,
      },
    };
  }

  /**
   * Make API request to QuickFile
   */
  private async makeRequest<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const submissionNumber = this.generateSubmissionNumber();
    const header = this.buildHeader(submissionNumber);

    const payload = {
      payload: {
        Header: header,
        Body: body,
      },
    };

    const response = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      // QuickFile returns schema-validation detail in the body — surface it
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `QuickFile API error: ${response.status} ${response.statusText}${errorBody ? ` — ${errorBody.slice(0, 500)}` : ''}`
      );
    }

    const data = await response.json();

    // Check for QuickFile error responses (both shapes the API uses)
    if (data.Error) {
      throw new Error(`QuickFile error: ${data.Error.Message}`);
    }
    if (data.Errors?.Error?.length) {
      throw new Error(`QuickFile error: ${data.Errors.Error.join('; ')}`);
    }

    return data as T;
  }

  /**
   * Test connection with credentials.
   * Uses a 1-row client/search — the cheapest authenticated read-only call the
   * API offers (there is no dedicated authenticate endpoint; the previous
   * system/authenticate path 404s).
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest<QuickFileApiResponse>('client/search', {
        SearchParameters: {
          ReturnCount: '1',
          Offset: '0',
          OrderResultsBy: 'CompanyName',
          OrderDirection: 'ASC',
        },
      });

      // Any well-formed Client_Search response means authentication succeeded
      return response.Client_Search?.Header?.MessageType === 'Response';
    } catch (error) {
      console.error('[QuickFileService] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Truncate a string to QuickFile's schema limits (which 400 on overflow).
   */
  private clip(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : value.slice(0, maxLength);
  }

  /**
   * Find-or-create the ledger client used for consolidated marketplace sales
   * invoices. Invoice_Create requires a real ClientID (0 is rejected by the
   * schema). Cached per service instance.
   */
  private ensuredClientId: number | null = null;

  async ensureLedgerClient(): Promise<number> {
    if (this.ensuredClientId) return this.ensuredClientId;

    const name = 'Marketplace Sales';
    const search = await this.makeRequest<{
      Client_Search?: { Body?: { RecordsetCount?: number; Record?: Array<{ ClientID?: number }> } };
    }>('client/search', {
      SearchParameters: {
        ReturnCount: '1',
        Offset: '0',
        OrderResultsBy: 'CompanyName',
        OrderDirection: 'ASC',
        CompanyName: name,
      },
    });

    const found = search.Client_Search?.Body?.Record?.[0]?.ClientID;
    if (found) {
      this.ensuredClientId = found;
      return found;
    }

    const created = await this.makeRequest<{
      Client_Create?: { Body?: { ClientID?: number } };
    }>('client/create', {
      ClientDetails: {
        CompanyName: name,
      },
      ClientContacts: {
        DefaultContact: {
          FirstName: 'Hadley',
          Surname: 'Bricks',
          Email: 'chris@hadleybricks.co.uk',
          // Client-portal password for this placeholder ledger client —
          // random, never used to log in anywhere.
          Password: crypto.randomBytes(9).toString('base64url'),
          TelephoneNumbers: {},
        },
      },
    });

    const clientId = created.Client_Create?.Body?.ClientID;
    if (!clientId) throw new Error('QuickFile client/create returned no ClientID');
    this.ensuredClientId = clientId;
    return clientId;
  }

  /**
   * Find-or-create the generic supplier for consolidated expense entries.
   * Purchase_Create requires a real SupplierID. Cached per service instance.
   */
  private ensuredSupplierId: number | null = null;

  async ensureLedgerSupplier(): Promise<number> {
    if (this.ensuredSupplierId) return this.ensuredSupplierId;

    const name = 'Marketplace & Sundry Suppliers';
    const search = await this.makeRequest<{
      Supplier_Search?: {
        Body?: { RecordsetCount?: number; Record?: Array<{ SupplierID?: number }> };
      };
    }>('supplier/search', {
      SearchParameters: {
        ReturnCount: '1',
        Offset: '0',
        OrderResultsBy: 'CompanyName',
        OrderDirection: 'ASC',
        CompanyName: name,
      },
    });

    const found = search.Supplier_Search?.Body?.Record?.[0]?.SupplierID;
    if (found) {
      this.ensuredSupplierId = found;
      return found;
    }

    const created = await this.makeRequest<{
      Supplier_Create?: { Body?: { SupplierID?: number } };
    }>('supplier/create', {
      SupplierDetails: {
        CompanyName: name,
        CountryISO: 'GB',
      },
    });

    const supplierId = created.Supplier_Create?.Body?.SupplierID;
    if (!supplierId) throw new Error('QuickFile supplier/create returned no SupplierID');
    this.ensuredSupplierId = supplierId;
    return supplierId;
  }

  /**
   * Create a sales invoice in QuickFile.
   * Body shape per the v1_2 Invoice_Create schema: lines nest as
   * InvoiceLines → ItemLines → ItemLine[]; InvoiceDescription max 35 chars;
   * ItemName max 25; no Tax element = no VAT.
   */
  async createSalesInvoice(row: MtdSalesRow): Promise<{ success: boolean; invoiceId?: number }> {
    try {
      const clientId = await this.ensureLedgerClient();

      const body = {
        InvoiceData: {
          InvoiceType: 'INVOICE',
          ClientID: clientId,
          Currency: 'GBP',
          TermDays: 0,
          Language: 'en',
          InvoiceDescription: this.clip(row.description, 35),
          InvoiceLines: {
            ItemLines: {
              ItemLine: [
                {
                  ItemID: 0,
                  ItemName: this.clip(row.reference, 25),
                  ItemDescription: row.description,
                  ItemNominalCode: row.nominalCode,
                  UnitCost: row.netAmount,
                  Qty: 1,
                },
              ],
            },
          },
          Scheduling: {
            SingleInvoiceData: {
              IssueDate: row.date,
            },
          },
        },
      };

      const response = await this.makeRequest<QuickFileApiResponse>('invoice/create', body);

      return {
        success: true,
        invoiceId: response.Invoice_Create?.Body?.InvoiceID,
      };
    } catch (error) {
      console.error('[QuickFileService] Failed to create invoice:', error);
      throw error;
    }
  }

  /**
   * Create a purchase entry in QuickFile.
   * Body shape per the v1_2 Purchase_Create schema: requires SupplierID,
   * ReceiptDate, and InvoiceLines with SubTotal/VatRate line items.
   */
  async createPurchase(row: MtdExpenseRow): Promise<{ success: boolean; purchaseId?: number }> {
    try {
      const supplierId = await this.ensureLedgerSupplier();

      const body = {
        PurchaseData: {
          SupplierID: supplierId,
          Currency: 'GBP',
          InvoiceDescription: this.clip(row.description, 35),
          ReceiptDate: row.date,
          TermDays: 0,
          InvoiceLines: {
            ItemLine: [
              {
                ItemNominalCode: row.nominalCode,
                ItemDescription: row.description,
                SubTotal: row.netAmount,
                VatRate: 0,
              },
            ],
          },
        },
      };

      const response = await this.makeRequest<QuickFileApiResponse>('purchase/create', body);

      return {
        success: true,
        purchaseId: response.Purchase_Create?.Body?.PurchaseID,
      };
    } catch (error) {
      console.error('[QuickFileService] Failed to create purchase:', error);
      throw error;
    }
  }

  /**
   * Push all MTD data to QuickFile
   */
  async pushMtdData(
    sales: MtdSalesRow[],
    expenses: MtdExpenseRow[]
  ): Promise<{
    success: boolean;
    invoicesCreated: number;
    purchasesCreated: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let invoicesCreated = 0;
    let purchasesCreated = 0;

    // Create sales invoices
    for (const row of sales) {
      try {
        await this.createSalesInvoice(row);
        invoicesCreated++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Sales invoice (${row.reference}): ${message}`);
      }
    }

    // Create purchase entries
    for (const row of expenses) {
      try {
        await this.createPurchase(row);
        purchasesCreated++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Purchase (${row.reference}): ${message}`);
      }
    }

    return {
      success: errors.length === 0,
      invoicesCreated,
      purchasesCreated,
      errors,
    };
  }
}
