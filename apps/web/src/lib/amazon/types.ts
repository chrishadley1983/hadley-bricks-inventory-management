/**
 * Amazon SP-API Types
 *
 * Types for Amazon Selling Partner API integration.
 * Focused on Orders API for EU marketplaces.
 */

// ============================================
// Authentication Types
// ============================================

export interface AmazonCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sellerId: string;
  marketplaceIds: string[];
}

export interface AmazonTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AmazonAccessToken {
  accessToken: string;
  expiresAt: Date;
}

// ============================================
// Marketplace Types
// ============================================

export type AmazonMarketplaceId =
  | 'A1F83G8C2ARO7P' // UK
  | 'A1PA6795UKMFR9' // DE
  | 'A13V1IB3VIYBER' // FR
  | 'APJ6JRA9NG5V4' // IT
  | 'A1RKKUPIHCS9HS' // ES
  | 'ATVPDKIKX0DER' // US
  | 'A2EUQ1WTGCTBG2'; // CA

export const MARKETPLACE_INFO: Record<
  string,
  { name: string; country: string; endpoint: string; currency: string }
> = {
  A1F83G8C2ARO7P: {
    name: 'Amazon UK',
    country: 'GB',
    endpoint: 'https://sellingpartnerapi-eu.amazon.com',
    currency: 'GBP',
  },
  A1PA6795UKMFR9: {
    name: 'Amazon DE',
    country: 'DE',
    endpoint: 'https://sellingpartnerapi-eu.amazon.com',
    currency: 'EUR',
  },
  A13V1IB3VIYBER: {
    name: 'Amazon FR',
    country: 'FR',
    endpoint: 'https://sellingpartnerapi-eu.amazon.com',
    currency: 'EUR',
  },
  APJ6JRA9NG5V4: {
    name: 'Amazon IT',
    country: 'IT',
    endpoint: 'https://sellingpartnerapi-eu.amazon.com',
    currency: 'EUR',
  },
  A1RKKUPIHCS9HS: {
    name: 'Amazon ES',
    country: 'ES',
    endpoint: 'https://sellingpartnerapi-eu.amazon.com',
    currency: 'EUR',
  },
  ATVPDKIKX0DER: {
    name: 'Amazon US',
    country: 'US',
    endpoint: 'https://sellingpartnerapi-na.amazon.com',
    currency: 'USD',
  },
  A2EUQ1WTGCTBG2: {
    name: 'Amazon CA',
    country: 'CA',
    endpoint: 'https://sellingpartnerapi-na.amazon.com',
    currency: 'CAD',
  },
};

// EU endpoint for all EU marketplaces
export const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

// ============================================
// Orders API Types
// ============================================

export type AmazonOrderStatus =
  | 'Pending'
  | 'Unshipped'
  | 'PartiallyShipped'
  | 'Shipped'
  | 'Canceled'
  | 'Unfulfillable'
  | 'InvoiceUnconfirmed'
  | 'PendingAvailability';

export type AmazonFulfillmentChannel = 'MFN' | 'AFN'; // Merchant vs Amazon Fulfilled

export interface AmazonMoney {
  CurrencyCode: string;
  Amount: string;
}

export interface AmazonAddress {
  Name?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  City?: string;
  County?: string;
  District?: string;
  StateOrRegion?: string;
  PostalCode?: string;
  CountryCode?: string;
  Phone?: string;
  AddressType?: 'Residential' | 'Commercial';
}

export interface AmazonBuyerInfo {
  BuyerEmail?: string;
  BuyerName?: string;
  BuyerCounty?: string;
  BuyerTaxInfo?: {
    CompanyLegalName?: string;
    TaxingRegion?: string;
    TaxClassifications?: Array<{
      Name: string;
      Value: string;
    }>;
  };
  PurchaseOrderNumber?: string;
}

export interface AmazonOrder {
  AmazonOrderId: string;
  SellerOrderId?: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: AmazonOrderStatus;
  FulfillmentChannel: AmazonFulfillmentChannel;
  SalesChannel?: string;
  OrderChannel?: string;
  ShipServiceLevel?: string;
  OrderTotal?: AmazonMoney;
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  PaymentExecutionDetail?: Array<{
    Payment: AmazonMoney;
    PaymentMethod: string;
  }>;
  PaymentMethod?: string;
  PaymentMethodDetails?: string[];
  MarketplaceId: string;
  ShipmentServiceLevelCategory?: string;
  EasyShipShipmentStatus?: string;
  OrderType?: 'StandardOrder' | 'LongLeadTimeOrder' | 'Preorder' | 'BackOrder' | 'SourcingOnDemandOrder';
  EarliestShipDate?: string;
  LatestShipDate?: string;
  EarliestDeliveryDate?: string;
  LatestDeliveryDate?: string;
  IsBusinessOrder?: boolean;
  IsPrime?: boolean;
  IsPremiumOrder?: boolean;
  IsGlobalExpressEnabled?: boolean;
  ReplacedOrderId?: string;
  IsReplacementOrder?: boolean;
  PromiseResponseDueDate?: string;
  IsEstimatedShipDateSet?: boolean;
  IsSoldByAB?: boolean;
  IsIBA?: boolean;
  ShippingAddress?: AmazonAddress;
  BuyerInfo?: AmazonBuyerInfo;
  DefaultShipFromLocationAddress?: AmazonAddress;
  FulfillmentInstruction?: {
    FulfillmentSupplySourceId?: string;
  };
  IsISPU?: boolean;
  IsAccessPointOrder?: boolean;
  HasAutomatedShippingSettings?: boolean;
  EasyShipForceShipmentConflict?: boolean;
  AutomatedShippingSettings?: {
    HasAutomatedShippingSettings: boolean;
    AutomatedCarrier?: string;
    AutomatedShipMethod?: string;
  };
}

export interface AmazonOrderItem {
  ASIN: string;
  SellerSKU?: string;
  OrderItemId: string;
  Title?: string;
  QuantityOrdered: number;
  QuantityShipped?: number;
  ProductInfo?: {
    NumberOfItems?: number;
  };
  PointsGranted?: {
    PointsNumber: number;
    PointsMonetaryValue: AmazonMoney;
  };
  ItemPrice?: AmazonMoney;
  ShippingPrice?: AmazonMoney;
  ItemTax?: AmazonMoney;
  ShippingTax?: AmazonMoney;
  ShippingDiscount?: AmazonMoney;
  ShippingDiscountTax?: AmazonMoney;
  PromotionDiscount?: AmazonMoney;
  PromotionDiscountTax?: AmazonMoney;
  PromotionIds?: string[];
  CODFee?: AmazonMoney;
  CODFeeDiscount?: AmazonMoney;
  IsGift?: boolean;
  ConditionNote?: string;
  ConditionId?: string;
  ConditionSubtypeId?: string;
  ScheduledDeliveryStartDate?: string;
  ScheduledDeliveryEndDate?: string;
  PriceDesignation?: string;
  TaxCollection?: {
    Model: string;
    ResponsibleParty: string;
  };
  SerialNumberRequired?: boolean;
  IsTransparency?: boolean;
  IossNumber?: string;
  StoreChainStoreId?: string;
  DeemedResellerCategory?: string;
  BuyerInfo?: {
    BuyerCustomizedInfo?: {
      CustomizedURL: string;
    };
    GiftWrapPrice?: AmazonMoney;
    GiftWrapTax?: AmazonMoney;
    GiftMessageText?: string;
    GiftWrapLevel?: string;
  };
  BuyerRequestedCancel?: {
    IsBuyerRequestedCancel: boolean;
    BuyerCancelReason?: string;
  };
}

// ============================================
// API Response Types
// ============================================

export interface AmazonOrdersResponse {
  payload: {
    Orders: AmazonOrder[];
    NextToken?: string;
    LastUpdatedBefore?: string;
    CreatedBefore?: string;
  };
}

export interface AmazonOrderItemsResponse {
  payload: {
    OrderItems: AmazonOrderItem[];
    NextToken?: string;
    AmazonOrderId: string;
  };
}

export interface AmazonOrderResponse {
  payload: AmazonOrder;
}

export interface AmazonErrorResponse {
  errors: Array<{
    code: string;
    message: string;
    details?: string;
  }>;
}

// ============================================
// Request Parameters
// ============================================

export interface GetOrdersParams {
  MarketplaceIds?: string[];
  CreatedAfter?: string;
  CreatedBefore?: string;
  LastUpdatedAfter?: string;
  LastUpdatedBefore?: string;
  OrderStatuses?: AmazonOrderStatus[];
  FulfillmentChannels?: AmazonFulfillmentChannel[];
  PaymentMethods?: string[];
  BuyerEmail?: string;
  SellerOrderId?: string;
  MaxResultsPerPage?: number;
  EasyShipShipmentStatuses?: string[];
  ElectronicInvoiceStatuses?: string[];
  NextToken?: string;
  AmazonOrderIds?: string[];
  ActualFulfillmentSupplySourceId?: string;
  IsISPU?: boolean;
  StoreChainStoreId?: string;
}

// ============================================
// Rate Limit Info
// ============================================

export interface AmazonRateLimitInfo {
  remaining: number;
  resetTime: Date;
  limit: number;
}

// ============================================
// Normalized Order Types (for our system)
// ============================================

export interface NormalizedAmazonOrder {
  platformOrderId: string;
  orderDate: Date;
  buyerName: string;
  buyerEmail?: string;
  status: string;
  subtotal: number;
  shipping: number;
  fees: number;
  total: number;
  currency: string;
  marketplace: string;
  marketplaceId: string;
  fulfillmentChannel: string;
  latestShipDate?: Date;
  shippingAddress?: {
    name: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode: string;
  };
  items: NormalizedAmazonOrderItem[];
  rawData: AmazonOrder;
}

export interface NormalizedAmazonOrderItem {
  asin: string;
  sku?: string;
  title: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
}

// ============================================
// Finances API v2024-06-19 Types
// ============================================

/**
 * Transaction types from Amazon Finances API
 */
export type AmazonTransactionType =
  | 'Shipment'
  | 'Refund'
  | 'ServiceFee'
  | 'Adjustment'
  | 'Transfer'
  | 'Liquidations'
  | 'FBAInventoryFee'
  | 'Guarantee'
  | 'Chargeback'
  | 'PayWithAmazon'
  | 'SalesTaxServiceFee'
  | 'RenewedProgram'
  | 'RetroCharge';

/**
 * Transaction status from Finances API
 */
export type AmazonFinancialTransactionStatus =
  | 'RELEASED'
  | 'DEFERRED'
  | 'DEFERRED_RELEASED';

/**
 * Money amount from Finances API
 */
export interface AmazonFinancesMoney {
  currencyCode: string;
  currencyAmount: string;
}

/**
 * Selling partner metadata
 */
export interface AmazonSellingPartnerMetadata {
  sellingPartnerId: string;
  marketplaceId: string;
  accountType: string;
}

/**
 * Related identifier for linking transactions to orders
 */
export interface AmazonRelatedIdentifier {
  relatedIdentifierName: string;
  relatedIdentifierValue: string;
}

/**
 * Transaction context (item/product info)
 */
export interface AmazonTransactionContext {
  contextType: string;
  storeName?: string;
  asin?: string;
  sku?: string;
  quantityShipped?: number;
  fulfillmentNetwork?: string;
}

/**
 * Fee breakdown item (recursive structure)
 */
export interface AmazonTransactionBreakdown {
  breakdownType: string;
  breakdownAmount: AmazonFinancesMoney;
  breakdowns?: AmazonTransactionBreakdown[];
}

/**
 * Financial transaction from Finances API v2024-06-19
 */
export interface AmazonFinancialTransaction {
  sellingPartnerMetadata: AmazonSellingPartnerMetadata;
  transactionType: AmazonTransactionType | string;
  transactionStatus: AmazonFinancialTransactionStatus;
  relatedIdentifiers: AmazonRelatedIdentifier[];
  totalAmount: AmazonFinancesMoney;
  postedDate: string;
  description?: string;
  contexts?: AmazonTransactionContext[];
  breakdowns?: AmazonTransactionBreakdown[];
}

/**
 * List transactions response payload
 */
export interface AmazonListTransactionsPayload {
  transactions?: AmazonFinancialTransaction[];
  nextToken?: string;
}

/**
 * List transactions response (wrapped in payload)
 */
export interface AmazonListTransactionsResponse {
  payload: AmazonListTransactionsPayload;
}

/**
 * List transactions request parameters
 */
export interface AmazonListTransactionsParams {
  postedAfter: string;
  postedBefore?: string;
  marketplaceId?: string;
  nextToken?: string;
}

// ============================================
// Database Row Types for Amazon Transactions
// ============================================

/**
 * Amazon transaction row as stored in database
 */
export interface AmazonTransactionRow {
  id: string;
  user_id: string;
  amazon_transaction_id: string;
  amazon_order_id: string | null;
  seller_order_id: string | null;
  marketplace_id: string | null;
  transaction_type: string;
  transaction_status: string | null;
  posted_date: string;
  description: string | null;
  total_amount: number;
  currency: string;
  referral_fee: number | null;
  fba_fulfillment_fee: number | null;
  fba_per_unit_fee: number | null;
  fba_weight_fee: number | null;
  fba_inventory_storage_fee: number | null;
  shipping_credit: number | null;
  shipping_credit_tax: number | null;
  promotional_rebate: number | null;
  sales_tax_collected: number | null;
  marketplace_facilitator_tax: number | null;
  gift_wrap_credit: number | null;
  other_fees: number | null;
  gross_sales_amount: number | null;
  net_amount: number | null;
  total_fees: number | null;
  item_title: string | null;
  asin: string | null;
  seller_sku: string | null;
  quantity: number | null;
  fulfillment_channel: string | null;
  store_name: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  breakdowns: AmazonTransactionBreakdown[] | null;
  contexts: AmazonTransactionContext[] | null;
  related_identifiers: AmazonRelatedIdentifier[] | null;
  raw_response: AmazonFinancialTransaction;
  created_at: string;
  updated_at: string;
}

/**
 * Amazon settlement row as stored in database
 */
export interface AmazonSettlementRow {
  id: string;
  user_id: string;
  financial_event_group_id: string;
  settlement_id: string | null;
  fund_transfer_status: string | null;
  fund_transfer_date: string | null;
  trace_id: string | null;
  account_tail: string | null;
  processing_period_start: string | null;
  processing_period_end: string | null;
  beginning_balance: number | null;
  total_amount: number;
  currency: string;
  transaction_count: number | null;
  raw_response: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * Amazon sync config row
 */
export interface AmazonSyncConfigRow {
  id: string;
  user_id: string;
  auto_sync_enabled: boolean;
  auto_sync_interval_hours: number;
  last_auto_sync_at: string | null;
  next_auto_sync_at: string | null;
  transactions_posted_cursor: string | null;
  settlements_cursor: string | null;
  historical_import_started_at: string | null;
  historical_import_completed_at: string | null;
  historical_import_from_date: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Amazon sync log row
 */
export interface AmazonSyncLogRow {
  id: string;
  user_id: string;
  sync_type: 'TRANSACTIONS' | 'SETTLEMENTS';
  sync_mode: 'FULL' | 'INCREMENTAL' | 'HISTORICAL';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  started_at: string;
  completed_at: string | null;
  records_processed: number | null;
  records_created: number | null;
  records_updated: number | null;
  last_sync_cursor: string | null;
  from_date: string | null;
  to_date: string | null;
  error_message: string | null;
  created_at: string;
}

// ============================================
// Fee Type Mapping
// ============================================

/**
 * Map of Amazon breakdown types to database column names
 */
export const AMAZON_FEE_TYPE_MAPPING: Record<string, string> = {
  Commission: 'referral_fee',
  FBAPerUnitFulfillmentFee: 'fba_per_unit_fee',
  FBAWeightBasedFee: 'fba_weight_fee',
  FBAFees: 'fba_fulfillment_fee',
  StorageFee: 'fba_inventory_storage_fee',
  ShippingHB: 'shipping_credit',
  ShippingTax: 'shipping_credit_tax',
  PromotionalRebate: 'promotional_rebate',
  SalesTax: 'sales_tax_collected',
  MarketplaceFacilitatorTax: 'marketplace_facilitator_tax',
  GiftWrap: 'gift_wrap_credit',
};

/**
 * Transaction type labels for UI display
 */
export const AMAZON_TRANSACTION_TYPE_LABELS: Record<string, string> = {
  Shipment: 'Sale',
  Refund: 'Refund',
  ServiceFee: 'Service Fee',
  Adjustment: 'Adjustment',
  Transfer: 'Transfer',
  Liquidations: 'Liquidation',
  FBAInventoryFee: 'FBA Fee',
  Guarantee: 'A-to-z Claim',
  Chargeback: 'Chargeback',
  PayWithAmazon: 'Pay with Amazon',
  SalesTaxServiceFee: 'Tax Service Fee',
  RenewedProgram: 'Renewed Program',
  RetroCharge: 'Retro Charge',
};

/**
 * Marketplace labels for UI display
 */
export const AMAZON_MARKETPLACE_LABELS: Record<string, string> = {
  A1F83G8C2ARO7P: 'UK',
  A1PA6795UKMFR9: 'DE',
  A13V1IB3VIYBER: 'FR',
  APJ6JRA9NG5V4: 'IT',
  A1RKKUPIHCS9HS: 'ES',
  ATVPDKIKX0DER: 'US',
  A2EUQ1WTGCTBG2: 'CA',
};
