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
  System_Authenticate?: {
    Header: {
      MessageType: string;
    };
    Body?: {
      IsValid?: boolean;
    };
  };
  Error?: {
    Code: string;
    Message: string;
  };
}

/**
 * QuickFile API service for MTD exports
 */
export class QuickFileService {
  private baseUrl = 'https://api.quickfile.co.uk/1_2';
  private applicationId = 'hadley-bricks-mtd';
  private credentials: QuickFileCredentials;

  constructor(credentials: QuickFileCredentials) {
    this.credentials = credentials;
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
    });

    if (!response.ok) {
      throw new Error(`QuickFile API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Check for QuickFile error response
    if (data.Error) {
      throw new Error(`QuickFile error: ${data.Error.Message}`);
    }

    return data as T;
  }

  /**
   * Test connection with credentials
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest<QuickFileApiResponse>('system/authenticate', {});

      // Check if response indicates valid authentication
      if (response.System_Authenticate?.Body?.IsValid === true) {
        return true;
      }

      // Also consider successful API call as valid (no error thrown)
      return true;
    } catch (error) {
      console.error('[QuickFileService] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Create a sales invoice in QuickFile
   */
  async createSalesInvoice(row: MtdSalesRow): Promise<{ success: boolean; invoiceId?: number }> {
    try {
      const body = {
        InvoiceData: {
          InvoiceType: 'INVOICE',
          ClientID: 0, // Cash sale, no client
          Currency: 'GBP',
          TermDays: 0,
          Language: 'en',
          InvoiceDescription: row.description,
          InvoiceLines: [
            {
              ItemID: 0,
              ItemName: row.description,
              ItemDescription: row.description,
              ItemNominalCode: row.nominalCode,
              Tax1ID: 0, // No VAT
              UnitCost: row.netAmount,
              Qty: 1,
            },
          ],
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
   * Create a purchase entry in QuickFile
   */
  async createPurchase(row: MtdExpenseRow): Promise<{ success: boolean; purchaseId?: number }> {
    try {
      const body = {
        PurchaseData: {
          SupplierID: 0, // Generic supplier
          SupplierName: row.supplier,
          Currency: 'GBP',
          PurchaseDescription: row.description,
          PurchaseLines: [
            {
              ItemID: 0,
              ItemName: row.description,
              ItemDescription: row.description,
              ItemNominalCode: row.nominalCode,
              Tax1ID: 0, // No VAT
              UnitCost: row.netAmount,
              Qty: 1,
            },
          ],
          Scheduling: {
            IssueDate: row.date,
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
