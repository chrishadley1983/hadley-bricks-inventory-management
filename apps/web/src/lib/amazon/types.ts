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
