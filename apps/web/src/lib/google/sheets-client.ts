import { google, sheets_v4 } from 'googleapis';

/**
 * Represents a single sheet (tab) within a Google Spreadsheet
 */
export interface SheetInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

/**
 * Represents a column with its header and sample data
 */
export interface ColumnInfo {
  index: number;
  letter: string;
  header: string;
  sampleValues: string[];
  inferredType: 'string' | 'number' | 'date' | 'boolean' | 'empty';
}

/**
 * Complete structure of a sheet including columns
 */
export interface SheetStructure {
  sheetInfo: SheetInfo;
  columns: ColumnInfo[];
  totalRows: number;
}

/**
 * Complete spreadsheet structure with all sheets
 */
export interface SpreadsheetStructure {
  spreadsheetId: string;
  title: string;
  sheets: SheetStructure[];
}

/**
 * Configuration for the Google Sheets client
 */
interface SheetsClientConfig {
  serviceAccountEmail: string;
  privateKey: string;
  spreadsheetId: string;
}

/**
 * Google Sheets API client for reading and writing data
 */
export class GoogleSheetsClient {
  private sheets: sheets_v4.Sheets | null = null;
  private config: SheetsClientConfig;

  constructor(config?: Partial<SheetsClientConfig>) {
    this.config = {
      serviceAccountEmail:
        config?.serviceAccountEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
      privateKey: config?.privateKey || process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '',
      spreadsheetId: config?.spreadsheetId || process.env.GOOGLE_SHEETS_ID || '',
    };
  }

  /**
   * Initialize the Google Sheets API client
   */
  private async getClient(): Promise<sheets_v4.Sheets> {
    if (this.sheets) {
      return this.sheets;
    }

    if (!this.config.serviceAccountEmail || !this.config.privateKey) {
      throw new Error(
        'Google Sheets credentials not configured. Please set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY environment variables.'
      );
    }

    const auth = new google.auth.JWT({
      email: this.config.serviceAccountEmail,
      key: this.config.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    return this.sheets;
  }

  /**
   * Test the connection to Google Sheets
   */
  async testConnection(): Promise<{ success: boolean; message: string; spreadsheetTitle?: string }> {
    try {
      const client = await this.getClient();
      const response = await client.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId,
        fields: 'properties.title',
      });

      return {
        success: true,
        message: 'Successfully connected to Google Sheets',
        spreadsheetTitle: response.data.properties?.title || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to connect: ${message}`,
      };
    }
  }

  /**
   * Get all sheets (tabs) in the spreadsheet
   */
  async listSheets(): Promise<SheetInfo[]> {
    const client = await this.getClient();
    const response = await client.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheets = response.data.sheets || [];
    return sheets.map((sheet) => ({
      sheetId: sheet.properties?.sheetId || 0,
      title: sheet.properties?.title || 'Untitled',
      index: sheet.properties?.index || 0,
      rowCount: sheet.properties?.gridProperties?.rowCount || 0,
      columnCount: sheet.properties?.gridProperties?.columnCount || 0,
    }));
  }

  /**
   * Convert column index to letter (0 = A, 25 = Z, 26 = AA, etc.)
   */
  private columnIndexToLetter(index: number): string {
    let letter = '';
    let temp = index;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  }

  /**
   * Infer the data type from sample values
   */
  private inferType(values: string[]): ColumnInfo['inferredType'] {
    const nonEmpty = values.filter((v) => v && v.trim() !== '');
    if (nonEmpty.length === 0) return 'empty';

    // Check if all values are numbers
    const allNumbers = nonEmpty.every((v) => !isNaN(Number(v.replace(/[£$,]/g, ''))));
    if (allNumbers) return 'number';

    // Check if all values are dates (various formats)
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}$/, // ISO format
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // US/UK format
      /^\d{1,2}-\d{1,2}-\d{2,4}$/, // Alternative format
    ];
    const allDates = nonEmpty.every((v) => datePatterns.some((p) => p.test(v.trim())));
    if (allDates) return 'date';

    // Check if all values are booleans
    const boolValues = ['true', 'false', 'yes', 'no', '1', '0'];
    const allBools = nonEmpty.every((v) => boolValues.includes(v.toLowerCase().trim()));
    if (allBools) return 'boolean';

    return 'string';
  }

  /**
   * Get the structure of a specific sheet including column headers and sample data
   */
  async getSheetStructure(sheetTitle: string, sampleRows: number = 5): Promise<SheetStructure> {
    const client = await this.getClient();

    // Get sheet properties
    const sheetsResponse = await client.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheet = sheetsResponse.data.sheets?.find((s) => s.properties?.title === sheetTitle);
    if (!sheet) {
      throw new Error(`Sheet "${sheetTitle}" not found`);
    }

    const sheetInfo: SheetInfo = {
      sheetId: sheet.properties?.sheetId || 0,
      title: sheet.properties?.title || 'Untitled',
      index: sheet.properties?.index || 0,
      rowCount: sheet.properties?.gridProperties?.rowCount || 0,
      columnCount: sheet.properties?.gridProperties?.columnCount || 0,
    };

    // Get header row and sample data
    const range = `'${sheetTitle}'!A1:${this.columnIndexToLetter(sheetInfo.columnCount - 1)}${sampleRows + 1}`;
    const dataResponse = await client.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range,
    });

    const rows = dataResponse.data.values || [];
    const headers = rows[0] || [];
    const dataRows = rows.slice(1);

    const columns: ColumnInfo[] = headers.map((header, index) => {
      const sampleValues = dataRows.map((row) => (row[index] || '').toString());
      return {
        index,
        letter: this.columnIndexToLetter(index),
        header: header?.toString() || '',
        sampleValues,
        inferredType: this.inferType(sampleValues),
      };
    });

    return {
      sheetInfo,
      columns,
      totalRows: sheetInfo.rowCount - 1, // Exclude header row
    };
  }

  /**
   * Discover the complete structure of all sheets in the spreadsheet
   */
  async discoverSpreadsheetStructure(sampleRows: number = 5): Promise<SpreadsheetStructure> {
    const client = await this.getClient();

    // Get spreadsheet title
    const spreadsheetResponse = await client.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: 'properties.title',
    });

    const sheets = await this.listSheets();
    const sheetStructures: SheetStructure[] = [];

    for (const sheet of sheets) {
      try {
        const structure = await this.getSheetStructure(sheet.title, sampleRows);
        sheetStructures.push(structure);
      } catch (error) {
        console.error(`Error getting structure for sheet "${sheet.title}":`, error);
        // Add sheet with empty columns if we can't read it
        sheetStructures.push({
          sheetInfo: sheet,
          columns: [],
          totalRows: 0,
        });
      }
    }

    return {
      spreadsheetId: this.config.spreadsheetId,
      title: spreadsheetResponse.data.properties?.title || 'Untitled Spreadsheet',
      sheets: sheetStructures,
    };
  }

  /**
   * Read all data from a specific sheet
   */
  async readSheet(sheetTitle: string): Promise<Record<string, string>[]> {
    const client = await this.getClient();

    const response = await client.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `'${sheetTitle}'`,
    });

    const rows = response.data.values || [];
    if (rows.length < 2) return [];

    const headers = rows[0].map((h) => h?.toString() || '');
    const dataRows = rows.slice(1);

    return dataRows.map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = row[index]?.toString() || '';
      });
      return record;
    });
  }

  /**
   * Read a range of data from a specific sheet
   */
  async readRange(range: string): Promise<string[][]> {
    const client = await this.getClient();

    const response = await client.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range,
    });

    return (response.data.values || []).map((row) => row.map((cell) => cell?.toString() || ''));
  }

  /**
   * Append a row to a sheet
   */
  async appendRow(sheetTitle: string, values: (string | number | null)[]): Promise<void> {
    const client = await this.getClient();

    await client.spreadsheets.values.append({
      spreadsheetId: this.config.spreadsheetId,
      range: `'${sheetTitle}'!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [values],
      },
    });
  }

  /**
   * Update a specific row in a sheet
   */
  async updateRow(
    sheetTitle: string,
    rowNumber: number,
    values: (string | number | null)[]
  ): Promise<void> {
    const client = await this.getClient();
    const lastColumn = this.columnIndexToLetter(values.length - 1);

    await client.spreadsheets.values.update({
      spreadsheetId: this.config.spreadsheetId,
      range: `'${sheetTitle}'!A${rowNumber}:${lastColumn}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
  }

  /**
   * Find a row by a specific column value
   */
  async findRow(
    sheetTitle: string,
    columnHeader: string,
    value: string
  ): Promise<{ rowNumber: number; data: Record<string, string> } | null> {
    const data = await this.readSheet(sheetTitle);

    for (let i = 0; i < data.length; i++) {
      if (data[i][columnHeader] === value) {
        return {
          rowNumber: i + 2, // +1 for 0-index, +1 for header row
          data: data[i],
        };
      }
    }

    return null;
  }

  /**
   * Delete a row from a sheet
   */
  async deleteRow(sheetTitle: string, rowNumber: number): Promise<void> {
    const client = await this.getClient();

    // Get the sheet ID
    const sheetsResponse = await client.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheet = sheetsResponse.data.sheets?.find((s) => s.properties?.title === sheetTitle);
    if (!sheet) {
      throw new Error(`Sheet "${sheetTitle}" not found`);
    }

    const sheetId = sheet.properties?.sheetId;

    await client.spreadsheets.batchUpdate({
      spreadsheetId: this.config.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowNumber - 1, // 0-indexed
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    });
  }
}

// Singleton instance for use across the application
let sheetsClientInstance: GoogleSheetsClient | null = null;

/**
 * Get or create the singleton Google Sheets client
 */
export function getSheetsClient(): GoogleSheetsClient {
  if (!sheetsClientInstance) {
    sheetsClientInstance = new GoogleSheetsClient();
  }
  return sheetsClientInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetSheetsClient(): void {
  sheetsClientInstance = null;
}
