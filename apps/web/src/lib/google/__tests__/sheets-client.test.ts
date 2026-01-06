import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mocks that can be referenced in vi.mock
const { mockSheetsApi, MockJWT } = vi.hoisted(() => {
  const mockSheetsApi = {
    spreadsheets: {
      get: vi.fn(),
      values: {
        get: vi.fn(),
        append: vi.fn(),
        update: vi.fn(),
      },
      batchUpdate: vi.fn(),
    },
  };

  class MockJWT {
    email: string;
    key: string;
    scopes: string[];
    constructor(config: { email: string; key: string; scopes: string[] }) {
      this.email = config.email;
      this.key = config.key;
      this.scopes = config.scopes;
    }
  }

  return { mockSheetsApi, MockJWT };
});

// Mock the googleapis module
vi.mock('googleapis', () => ({
  google: {
    auth: {
      JWT: MockJWT,
    },
    sheets: vi.fn(() => mockSheetsApi),
  },
}));

import { GoogleSheetsClient, getSheetsClient, resetSheetsClient } from '../sheets-client';

describe('GoogleSheetsClient', () => {
  let client: GoogleSheetsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSheetsClient();
    client = new GoogleSheetsClient({
      serviceAccountEmail: 'test@test.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      spreadsheetId: 'test-spreadsheet-id',
    });
  });

  describe('testConnection', () => {
    it('should return success when connection works', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          properties: {
            title: 'Test Spreadsheet',
          },
        },
      });

      const result = await client.testConnection();

      expect(result.success).toBe(true);
      expect(result.spreadsheetTitle).toBe('Test Spreadsheet');
      expect(result.message).toContain('Successfully connected');
    });

    it('should return failure when connection fails', async () => {
      mockSheetsApi.spreadsheets.get.mockRejectedValue(new Error('Auth failed'));

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to connect');
    });

    it('should throw error when credentials not configured', async () => {
      const clientWithoutCreds = new GoogleSheetsClient({
        serviceAccountEmail: '',
        privateKey: '',
        spreadsheetId: 'test-id',
      });

      const result = await clientWithoutCreds.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('credentials not configured');
    });
  });

  describe('listSheets', () => {
    it('should return list of sheets', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                gridProperties: { rowCount: 100, columnCount: 26 },
              },
            },
            {
              properties: {
                sheetId: 1,
                title: 'Sheet2',
                index: 1,
                gridProperties: { rowCount: 50, columnCount: 10 },
              },
            },
          ],
        },
      });

      const result = await client.listSheets();

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Sheet1');
      expect(result[0].rowCount).toBe(100);
      expect(result[1].title).toBe('Sheet2');
    });

    it('should handle empty spreadsheet', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [],
        },
      });

      const result = await client.listSheets();

      expect(result).toHaveLength(0);
    });
  });

  describe('getSheetStructure', () => {
    it('should return sheet structure with columns', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Inventory',
                index: 0,
                gridProperties: { rowCount: 100, columnCount: 5 },
              },
            },
          ],
        },
      });

      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Name', 'Price', 'Date', 'Active'],
            ['SKU-001', 'Millennium Falcon', '649.99', '2024-12-20', 'true'],
            ['SKU-002', 'Batmobile', '199.99', '2024-12-19', 'false'],
          ],
        },
      });

      const result = await client.getSheetStructure('Inventory');

      expect(result.sheetInfo.title).toBe('Inventory');
      expect(result.columns).toHaveLength(5);
      expect(result.columns[0].header).toBe('ID');
      expect(result.columns[2].inferredType).toBe('number');
      expect(result.columns[3].inferredType).toBe('date');
      expect(result.columns[4].inferredType).toBe('boolean');
    });

    it('should throw error when sheet not found', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'OtherSheet',
              },
            },
          ],
        },
      });

      await expect(client.getSheetStructure('NonExistent')).rejects.toThrow(
        'Sheet "NonExistent" not found'
      );
    });
  });

  describe('readSheet', () => {
    it('should return sheet data as records', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Name', 'Price'],
            ['SKU-001', 'Millennium Falcon', '649.99'],
            ['SKU-002', 'Batmobile', '199.99'],
          ],
        },
      });

      const result = await client.readSheet('Inventory');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        ID: 'SKU-001',
        Name: 'Millennium Falcon',
        Price: '649.99',
      });
      expect(result[1].ID).toBe('SKU-002');
    });

    it('should handle empty sheet', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [['ID', 'Name']],
        },
      });

      const result = await client.readSheet('Empty');

      expect(result).toHaveLength(0);
    });

    it('should handle missing values in rows', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Name', 'Price'],
            ['SKU-001', 'Millennium Falcon'], // Missing price
            ['SKU-002', '', '199.99'], // Missing name
          ],
        },
      });

      const result = await client.readSheet('Inventory');

      expect(result[0].Price).toBe('');
      expect(result[1].Name).toBe('');
    });
  });

  describe('readRange', () => {
    it('should return raw values from range', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['A1', 'B1'],
            ['A2', 'B2'],
          ],
        },
      });

      const result = await client.readRange('Sheet1!A1:B2');

      expect(result).toEqual([
        ['A1', 'B1'],
        ['A2', 'B2'],
      ]);
    });
  });

  describe('appendRow', () => {
    it('should append a row to the sheet', async () => {
      mockSheetsApi.spreadsheets.values.append.mockResolvedValue({});

      await client.appendRow('Inventory', ['SKU-003', 'Death Star', 499.99]);

      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalledWith({
        spreadsheetId: 'test-spreadsheet-id',
        range: "'Inventory'!A:A",
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [['SKU-003', 'Death Star', 499.99]],
        },
      });
    });
  });

  describe('updateRow', () => {
    it('should update a specific row', async () => {
      mockSheetsApi.spreadsheets.values.update.mockResolvedValue({});

      await client.updateRow('Inventory', 5, ['SKU-001', 'Updated Name', 799.99]);

      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalledWith({
        spreadsheetId: 'test-spreadsheet-id',
        range: "'Inventory'!A5:C5",
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['SKU-001', 'Updated Name', 799.99]],
        },
      });
    });
  });

  describe('findRow', () => {
    it('should find a row by column value', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Name', 'Price'],
            ['SKU-001', 'Millennium Falcon', '649.99'],
            ['SKU-002', 'Batmobile', '199.99'],
            ['SKU-003', 'Death Star', '499.99'],
          ],
        },
      });

      const result = await client.findRow('Inventory', 'ID', 'SKU-002');

      expect(result).not.toBeNull();
      expect(result?.rowNumber).toBe(3); // Row 3 (1-indexed + header)
      expect(result?.data).toEqual({
        ID: 'SKU-002',
        Name: 'Batmobile',
        Price: '199.99',
      });
    });

    it('should return null when row not found', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Name'],
            ['SKU-001', 'Millennium Falcon'],
          ],
        },
      });

      const result = await client.findRow('Inventory', 'ID', 'INVALID');

      expect(result).toBeNull();
    });
  });

  describe('deleteRow', () => {
    it('should delete a row from the sheet', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 123,
                title: 'Inventory',
              },
            },
          ],
        },
      });
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({});

      await client.deleteRow('Inventory', 5);

      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-spreadsheet-id',
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: 123,
                  dimension: 'ROWS',
                  startIndex: 4, // 0-indexed
                  endIndex: 5,
                },
              },
            },
          ],
        },
      });
    });

    it('should throw error when sheet not found', async () => {
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [],
        },
      });

      await expect(client.deleteRow('NonExistent', 5)).rejects.toThrow(
        'Sheet "NonExistent" not found'
      );
    });
  });

  describe('discoverSpreadsheetStructure', () => {
    it('should discover complete spreadsheet structure', async () => {
      // First call for spreadsheet title
      mockSheetsApi.spreadsheets.get
        .mockResolvedValueOnce({
          data: {
            properties: { title: 'Hadley Bricks Inventory' },
          },
        })
        // Second call for sheets list
        .mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'Inventory',
                  index: 0,
                  gridProperties: { rowCount: 100, columnCount: 5 },
                },
              },
            ],
          },
        })
        // Third call for sheet structure
        .mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'Inventory',
                  index: 0,
                  gridProperties: { rowCount: 100, columnCount: 5 },
                },
              },
            ],
          },
        });

      mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Name', 'Price'],
            ['SKU-001', 'Test', '100'],
          ],
        },
      });

      const result = await client.discoverSpreadsheetStructure();

      expect(result.title).toBe('Hadley Bricks Inventory');
      expect(result.spreadsheetId).toBe('test-spreadsheet-id');
      expect(result.sheets).toHaveLength(1);
    });
  });

  describe('getSheetsClient singleton', () => {
    it('should return the same instance', () => {
      resetSheetsClient();
      const client1 = getSheetsClient();
      const client2 = getSheetsClient();

      expect(client1).toBe(client2);
    });

    it('should reset singleton', () => {
      const client1 = getSheetsClient();
      resetSheetsClient();
      const client2 = getSheetsClient();

      expect(client1).not.toBe(client2);
    });
  });
});
