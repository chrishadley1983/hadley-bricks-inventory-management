/**
 * Amazon Platform Stock Module
 *
 * Exports Amazon-specific functionality for stock reconciliation.
 */

export { AmazonReportsClient, createAmazonReportsClient } from './amazon-reports.client';
export type {
  AmazonReportType,
  ReportProcessingStatus,
  CreateReportRequest,
  CreateReportResponse,
  ReportStatusResponse,
  ReportDocumentResponse,
} from './amazon-reports.client';

export {
  parseAmazonListingsReport,
  getReportColumns,
  getColumnLabel,
} from './amazon-report-parser';
export type { ParsedAmazonListing, ParseReportResult } from './amazon-report-parser';

export { AmazonStockService } from './amazon-stock.service';
