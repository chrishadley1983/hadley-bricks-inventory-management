# Importing Listings

> Refresh Amazon listing data from Seller Central.

## Overview

The import process fetches the latest listing data from Amazon using the Selling Partner API (SP-API) reports system.

## Triggering an Import

### Header Refresh Button
1. Click the **Refresh** button in the page header
2. Button shows spinner while importing
3. Toast notification on success or failure

### Import Progress
- `ImportStatusBanner` shows during import
- Displays progress message
- Shows error details if failed

## Import Process

### Steps
1. **Create Import Record**: Track the import job
2. **Request Report**: Ask Amazon to generate inventory report
3. **Poll Status**: Wait for report to be ready
4. **Download Report**: Fetch the TSV/CSV data
5. **Parse Data**: Extract listing information
6. **Delete Old Data**: Remove previous listings
7. **Insert New Data**: Store fresh listings in batches
8. **Update Record**: Mark import complete

### Report Types
The import uses Amazon's `GET_MERCHANT_LISTINGS_ALL_DATA` report which includes:
- All active and inactive listings
- Quantity, price, status
- Fulfillment channel
- SKU and ASIN

## Import Status

### Import Record States

| Status | Description |
|--------|-------------|
| **pending** | Import queued |
| **processing** | Import in progress |
| **completed** | Import finished successfully |
| **failed** | Import encountered an error |

### Import Banner

The `ImportStatusBanner` component shows:
- **Importing**: "Importing listings from Amazon..." with spinner
- **Completed**: "Import completed" with timestamp
- **Failed**: Error message with details

## Header Information

The `PlatformStockHeader` shows:
- Platform name (Amazon Stock)
- Last import timestamp
- Refresh button with loading state

## Error Handling

### Common Errors
- **Authentication expired**: Re-authenticate with Amazon
- **Rate limited**: Wait and retry
- **Report unavailable**: Amazon report not ready
- **Network error**: Check connection

### Error Display
- Toast notification with error message
- Banner shows failed status
- Error message in import record

## Data Refresh

After successful import:
- All platform stock queries invalidated
- Listings view shows fresh data
- Comparison recalculates

## Source Files

- [page.tsx](../../../apps/web/src/app/(dashboard)/platform-stock/page.tsx:38-55) - Import trigger
- [PlatformStockHeader.tsx](../../../apps/web/src/components/features/platform-stock/PlatformStockHeader.tsx) - Header component
- [ImportStatusBanner.tsx](../../../apps/web/src/components/features/platform-stock/ImportStatusBanner.tsx) - Status display
- [use-platform-stock.ts](../../../apps/web/src/hooks/use-platform-stock.ts:190-205) - Import mutation
- [amazon-stock.service.ts](../../../apps/web/src/lib/platform-stock/amazon/amazon-stock.service.ts) - Import logic

## API Endpoint

```
POST /api/platform-stock/amazon/import
```

### Response
```json
{
  "data": {
    "import": {
      "id": "uuid",
      "status": "completed",
      "totalRows": 150,
      "processedRows": 150,
      "errorCount": 0
    },
    "message": "Import completed successfully"
  }
}
```

## Import History

```
GET /api/platform-stock/amazon/import?limit=10
```

Returns the last N import records for review.
