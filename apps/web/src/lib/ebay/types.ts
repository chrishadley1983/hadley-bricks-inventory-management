/**
 * eBay API Types
 *
 * Type definitions for eBay REST API responses and requests.
 * Based on eBay Fulfilment API and Finances API specifications.
 */

// ============================================================================
// Common Types
// ============================================================================

export interface EbayAmount {
  value: string;
  currency: string;
}

export interface EbayPhoneNumber {
  phoneNumber: string;
}

export interface EbayAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode: string;
}

export interface EbayContact {
  fullName: string;
  primaryPhone?: EbayPhoneNumber;
  email?: string;
}

// ============================================================================
// Fulfilment API Types
// ============================================================================

export interface EbayBuyer {
  username: string;
  taxIdentifier?: {
    taxpayerId: string;
    taxIdentifierType: string;
  };
}

export interface EbayPricingSummary {
  priceSubtotal?: EbayAmount;
  deliveryCost?: EbayAmount;
  deliveryDiscount?: EbayAmount;
  tax?: EbayAmount;
  total?: EbayAmount;
  adjustment?: EbayAmount;
  fee?: EbayAmount;
}

export interface EbayPayment {
  paymentMethod: string;
  paymentReferenceId?: string;
  paymentDate?: string;
  amount?: EbayAmount;
  paymentStatus?: string;
}

export interface EbayPaymentSummary {
  payments: EbayPayment[];
  refunds?: EbayRefund[];
  totalDueSeller?: EbayAmount;
}

export interface EbayRefund {
  refundDate?: string;
  refundAmount?: EbayAmount;
  refundReferenceId?: string;
  refundStatus?: string;
}

export interface EbayCancelRequest {
  cancelRequestId: string;
  cancelRequestState: string;
  cancelRequestedDate?: string;
  cancelReason?: string;
}

export interface EbayCancelStatus {
  cancelState: string;
  cancelRequests?: EbayCancelRequest[];
}

export interface EbayShippingStep {
  shippingCarrierCode?: string;
  shippingServiceCode?: string;
  shipTo?: EbayContact & { companyName?: string; contactAddress?: EbayAddress };
  shipToReferenceId?: string;
}

export interface EbayFulfilmentStartInstruction {
  fulfillmentInstructionsType: string;
  minEstimatedDeliveryDate?: string;
  maxEstimatedDeliveryDate?: string;
  shippingStep?: EbayShippingStep;
  ebaySupportedFulfillment?: boolean;
}

export interface EbayTax {
  amount: EbayAmount;
  taxType: string;
}

export interface EbayItemProperties {
  nameValueList?: Array<{ name: string; value: string }>;
}

export interface EbayLineItem {
  lineItemId: string;
  legacyItemId?: string;
  legacyVariationId?: string;
  sku?: string;
  title: string;
  quantity: number;
  lineItemCost: EbayAmount;
  total: EbayAmount;
  lineItemFulfillmentStatus: string;
  listingMarketplaceId?: string;
  purchaseMarketplaceId?: string;
  itemLocation?: EbayAddress;
  deliveryCost?: EbayAmount;
  discountedLineItemCost?: EbayAmount;
  taxes?: EbayTax[];
  properties?: EbayItemProperties;
  appliedPromotions?: unknown[];
}

export interface EbayOrderResponse {
  orderId: string;
  legacyOrderId?: string;
  creationDate: string;
  lastModifiedDate: string;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  buyer: EbayBuyer;
  buyerCheckoutNotes?: string;
  salesRecordReference?: string;
  totalFeeBasisAmount?: EbayAmount;
  pricingSummary?: EbayPricingSummary;
  paymentSummary?: EbayPaymentSummary;
  cancelStatus?: EbayCancelStatus;
  fulfillmentStartInstructions?: EbayFulfilmentStartInstruction[];
  lineItems: EbayLineItem[];
}

export interface EbayOrdersResponse {
  href?: string;
  total: number;
  limit: number;
  offset: number;
  orders: EbayOrderResponse[];
  next?: string;
  prev?: string;
}

export interface EbayShippingFulfilmentResponse {
  fulfillmentId: string;
  shipmentTrackingNumber?: string;
  shippingCarrierCode?: string;
  shippedDate?: string;
  lineItems: Array<{
    lineItemId: string;
    quantity: number;
  }>;
}

export interface EbayShippingFulfilmentsResponse {
  fulfillments: EbayShippingFulfilmentResponse[];
}

// ============================================================================
// Finances API Types
// ============================================================================

export interface EbayTransactionResponse {
  transactionId: string;
  transactionType: string;
  transactionStatus: string;
  transactionDate: string;
  amount: EbayAmount;
  bookingEntry: string;
  payoutId?: string;
  orderId?: string;
  buyer?: {
    username: string;
  };
  transactionMemo?: string;
  orderLineItems?: Array<{
    lineItemId: string;
    feeBasisAmount?: EbayAmount;
    marketplaceFees?: Array<{
      feeType: string;
      amount: EbayAmount;
    }>;
  }>;
  totalFeeAmount?: EbayAmount;
  references?: Array<{
    referenceId: string;
    referenceType: string;
  }>;
}

export interface EbayTransactionsResponse {
  href?: string;
  total: number;
  limit: number;
  offset: number;
  transactions: EbayTransactionResponse[];
  next?: string;
  prev?: string;
}

export interface EbayPayoutInstrument {
  instrumentType: string;
  nickname?: string;
  accountLastFourDigits?: string;
}

export interface EbayPayoutResponse {
  payoutId: string;
  payoutStatus: string;
  payoutDate: string;
  amount: EbayAmount;
  payoutInstrument?: EbayPayoutInstrument;
  transactionCount?: number;
}

export interface EbayPayoutsResponse {
  href?: string;
  total: number;
  limit: number;
  offset: number;
  payouts: EbayPayoutResponse[];
  next?: string;
  prev?: string;
}

// ============================================================================
// OAuth Types
// ============================================================================

export interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export interface EbayAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sandbox?: boolean;
}

// ============================================================================
// API Request Types
// ============================================================================

export interface EbayOrderFetchParams {
  filter?: string;
  limit?: number;
  offset?: number;
  orderIds?: string;
}

export interface EbayTransactionFetchParams {
  filter?: string;
  limit?: number;
  offset?: number;
  transactionType?: string;
}

export interface EbayPayoutFetchParams {
  filter?: string;
  limit?: number;
  offset?: number;
  payoutStatus?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export interface EbayApiError {
  errorId: number;
  domain: string;
  subdomain?: string;
  category: string;
  message: string;
  longMessage?: string;
  inputRefIds?: string[];
  outputRefIds?: string[];
  parameters?: Array<{ name: string; value: string }>;
}

export interface EbayErrorResponse {
  errors: EbayApiError[];
  warnings?: EbayApiError[];
}
