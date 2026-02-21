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
// Account API Types (Business Policies)
// ============================================================================

/**
 * Fulfillment policy from eBay Account API
 */
export interface EbayFulfillmentPolicy {
  fulfillmentPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  categoryTypes: Array<{
    name: string;
    default: boolean;
  }>;
  handlingTime: {
    value: number;
    unit: string;
  };
  shippingOptions: Array<{
    optionType: string;
    costType: string;
    shippingServices: Array<{
      shippingServiceCode: string;
      shippingCarrierCode?: string;
      freeShipping?: boolean;
      shippingCost?: EbayAmount;
      additionalShippingCost?: EbayAmount;
      sortOrder: number;
    }>;
    insuranceFee?: EbayAmount;
    insuranceOffered?: boolean;
  }>;
  globalShipping?: boolean;
  pickupDropOff?: boolean;
  freightShipping?: boolean;
  localPickup?: boolean;
}

export interface EbayFulfillmentPoliciesResponse {
  total: number;
  fulfillmentPolicies: EbayFulfillmentPolicy[];
}

/**
 * Payment policy from eBay Account API
 */
export interface EbayPaymentPolicy {
  paymentPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  categoryTypes: Array<{
    name: string;
    default: boolean;
  }>;
  paymentMethods: Array<{
    paymentMethodType: string;
    recipientAccountReference?: {
      referenceId: string;
      referenceType: string;
    };
  }>;
  immediatePay?: boolean;
}

export interface EbayPaymentPoliciesResponse {
  total: number;
  paymentPolicies: EbayPaymentPolicy[];
}

/**
 * Return policy from eBay Account API
 */
export interface EbayReturnPolicy {
  returnPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  categoryTypes: Array<{
    name: string;
    default: boolean;
  }>;
  returnsAccepted: boolean;
  returnPeriod?: {
    value: number;
    unit: string;
  };
  returnShippingCostPayer?: string;
  refundMethod?: string;
  returnMethod?: string;
  extendedHolidayReturnsOffered?: boolean;
}

export interface EbayReturnPoliciesResponse {
  total: number;
  returnPolicies: EbayReturnPolicy[];
}

// ============================================================================
// Inventory API Types
// ============================================================================

/**
 * Product details for inventory item
 */
export interface EbayProduct {
  title?: string;
  description?: string;
  aspects?: Record<string, string[]>;
  brand?: string;
  mpn?: string;
  ean?: string[];
  upc?: string[];
  isbn?: string[];
  epid?: string;
  imageUrls?: string[];
}

/**
 * Condition enum for inventory items
 */
export type EbayConditionEnum =
  | 'NEW'
  | 'LIKE_NEW'
  | 'NEW_OTHER'
  | 'NEW_WITH_DEFECTS'
  | 'MANUFACTURER_REFURBISHED'
  | 'CERTIFIED_REFURBISHED'
  | 'EXCELLENT_REFURBISHED'
  | 'VERY_GOOD_REFURBISHED'
  | 'GOOD_REFURBISHED'
  | 'SELLER_REFURBISHED'
  | 'USED'
  | 'USED_EXCELLENT'
  | 'USED_VERY_GOOD'
  | 'USED_GOOD'
  | 'USED_ACCEPTABLE'
  | 'FOR_PARTS_OR_NOT_WORKING';

/**
 * Availability for inventory item
 */
export interface EbayAvailability {
  shipToLocationAvailability?: {
    quantity: number;
    allocationByFormat?: {
      auction?: number;
      fixedPrice?: number;
    };
  };
  pickupAtLocationAvailability?: Array<{
    merchantLocationKey: string;
    quantity: number;
    fulfillmentTime?: {
      value: number;
      unit: string;
    };
  }>;
}

/**
 * Package weight and dimensions
 */
export interface EbayPackageWeightAndSize {
  dimensions?: {
    height: number;
    length: number;
    width: number;
    unit: string;
  };
  packageType?: string;
  weight?: {
    value: number;
    unit: string;
  };
}

/**
 * Inventory item for the Inventory API
 */
export interface EbayInventoryItem {
  sku?: string;
  locale?: string;
  product: EbayProduct;
  condition?: EbayConditionEnum;
  conditionDescription?: string;
  conditionDescriptors?: Array<{
    name: string;
    values: string[];
    additionalInfo?: string;
  }>;
  availability?: EbayAvailability;
  packageWeightAndSize?: EbayPackageWeightAndSize;
}

/**
 * Offer pricing
 */
export interface EbayPricingOfferSummary {
  price: EbayAmount;
  pricingVisibility?: string;
  originallySoldForRetailPriceOn?: string;
  originalRetailPrice?: EbayAmount;
  minimumAdvertisedPrice?: EbayAmount;
}

/**
 * Best Offer configuration
 */
export interface EbayBestOffer {
  autoAcceptPrice?: EbayAmount;
  autoDeclinePrice?: EbayAmount;
  bestOfferEnabled: boolean;
}

/**
 * Listing policies for an offer
 */
export interface EbayListingPolicies {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  ebayPlusIfEligible?: boolean;
  shippingCostOverrides?: Array<{
    priority: number;
    shippingCost?: EbayAmount;
    additionalShippingCost?: EbayAmount;
    shippingServiceType: string;
    surcharge?: EbayAmount;
  }>;
}

/**
 * Offer request for creating/updating an offer
 */
export interface EbayOfferRequest {
  sku: string;
  marketplaceId: string;
  format: 'FIXED_PRICE' | 'AUCTION';
  availableQuantity?: number;
  categoryId: string;
  listingDescription?: string;
  listingDuration?: string;
  listingStartDate?: string; // ISO 8601 date string for scheduling
  listingPolicies: EbayListingPolicies;
  pricingSummary: EbayPricingOfferSummary;
  quantityLimitPerBuyer?: number;
  secondaryCategoryId?: string;
  storeCategoryNames?: string[];
  tax?: {
    applyTax: boolean;
    thirdPartyTaxCategory?: string;
    vatPercentage?: number;
  };
  bestOffer?: EbayBestOffer;
  charity?: {
    charityId: string;
    donationPercentage: number;
  };
  extendedProducerResponsibility?: {
    producerProductId?: string;
    productPackageId?: string;
    shipmentPackageId?: string;
    productDocumentationId?: string;
    ecoParticipationFee?: EbayAmount;
  };
  lotSize?: number;
  merchantLocationKey?: string;
  includeCatalogProductDetails?: boolean;
  hideBuyerDetails?: boolean;
}

/**
 * Offer response from eBay
 */
export interface EbayOfferResponse {
  offerId: string;
  sku: string;
  marketplaceId: string;
  format: string;
  listingDescription?: string;
  availableQuantity?: number;
  soldQuantity?: number;
  listingPolicies?: EbayListingPolicies;
  pricingSummary?: EbayPricingOfferSummary;
  bestOffer?: EbayBestOffer;
  categoryId?: string;
  secondaryCategoryId?: string;
  listing?: {
    listingId: string;
    listingStatus: string;
    soldQuantity?: number;
  };
  status?: string;
  statusReason?: string;
}

/**
 * Response when creating an offer
 */
export interface EbayCreateOfferResponse {
  offerId: string;
  warnings?: EbayApiError[];
}

/**
 * Response when publishing an offer
 */
export interface EbayPublishOfferResponse {
  listingId: string;
  warnings?: EbayApiError[];
}

/**
 * Withdraw offer response
 */
export interface EbayWithdrawOfferResponse {
  warnings?: EbayApiError[];
}

// ============================================================================
// Inventory Location Types
// ============================================================================

/**
 * Inventory location from eBay
 */
export interface EbayInventoryLocation {
  merchantLocationKey: string;
  name?: string;
  merchantLocationStatus?: string;
  locationTypes?: string[];
  location?: {
    address?: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateOrProvince?: string;
      postalCode?: string;
      country?: string;
    };
  };
}

/**
 * Input for creating an inventory location
 */
export interface EbayInventoryLocationInput {
  location: {
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city: string;
      stateOrProvince?: string;
      postalCode: string;
      country: string;
    };
  };
  locationTypes?: string[];
  name?: string;
  merchantLocationStatus?: string;
}

// ============================================================================
// Taxonomy API Types
// ============================================================================

/**
 * Category suggestion from Taxonomy API
 */
export interface EbayCategorySuggestion {
  category: {
    categoryId: string;
    categoryName: string;
  };
  categoryTreeNodeLevel: number;
  categoryTreeNodeAncestors?: Array<{
    categoryId: string;
    categoryName: string;
    categoryTreeNodeLevel: number;
  }>;
  relevancy?: string;
}

export interface EbayCategorySuggestionsResponse {
  categorySuggestions: EbayCategorySuggestion[];
  categoryTreeId: string;
  categoryTreeVersion: string;
}

/**
 * Item aspect for a category
 */
export interface EbayItemAspect {
  localizedAspectName: string;
  aspectConstraint: {
    aspectRequired?: boolean;
    aspectUsage?: string;
    aspectEnabledForVariations?: boolean;
    aspectMode?: string;
    aspectDataType?: string;
    itemToAspectCardinality?: string;
    expectedRequiredByDate?: string;
  };
  aspectValues?: Array<{
    localizedValue: string;
    valueConstraints?: Array<{
      applicableForLocalizedAspectName?: string;
      applicableForLocalizedAspectValues?: string[];
    }>;
  }>;
  relevanceIndicator?: {
    searchCount?: number;
  };
}

export interface EbayItemAspectsResponse {
  categoryId: string;
  categoryName: string;
  categoryTreeId: string;
  aspects?: EbayItemAspect[];
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
