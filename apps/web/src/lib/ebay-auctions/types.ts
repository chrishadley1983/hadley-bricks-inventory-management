/**
 * eBay Auction Sniper Types
 */

// ============================================
// Configuration
// ============================================

export interface EbayAuctionConfig {
  id: string;
  userId: string;
  enabled: boolean;
  minMarginPercent: number;
  greatMarginPercent: number;
  minProfitGbp: number;
  maxBidPriceGbp: number | null;
  defaultPostageGbp: number;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  excludedSets: string[];
  scanWindowMinutes: number;
  minBids: number;
  maxSalesRank: number | null;
  joblotAnalysisEnabled: boolean;
  joblotMinTotalValueGbp: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Auction Items
// ============================================

export interface EbayAuctionItem {
  itemId: string;
  title: string;
  currentBidGbp: number;
  postageGbp: number;
  totalCostGbp: number;
  bidCount: number;
  auctionEndTime: string;
  minutesRemaining: number;
  itemUrl: string;
  imageUrl: string | null;
  condition: string | null;
  seller: {
    username: string;
    feedbackPercentage: number;
    feedbackScore: number;
  } | null;
}

export interface IdentifiedSet {
  setNumber: string;
  confidence: 'high' | 'medium' | 'low';
  method: 'regex_title' | 'regex_description';
}

export interface AmazonPricingData {
  asin: string;
  amazonPrice: number;
  was90dAvg: number | null;
  salesRank: number | null;
  setName: string | null;
  ukRrp: number | null;
}

export interface AuctionOpportunity {
  auction: EbayAuctionItem;
  setIdentification: IdentifiedSet;
  amazonData: AmazonPricingData;
  profitBreakdown: AuctionProfitBreakdown;
  alertTier: 'great' | 'good';
}

export interface JoblotSetEntry {
  setNumber: string;
  setName: string | null;
  amazonPrice: number | null;
  asin: string | null;
}

export interface JoblotOpportunity {
  auction: EbayAuctionItem;
  sets: JoblotSetEntry[];
  totalAmazonValue: number;
  totalCost: number;
  estimatedProfit: number;
  marginPercent: number;
}

// ============================================
// Profit Calculation
// ============================================

export interface AuctionProfitBreakdown {
  // eBay purchase cost
  currentBid: number;
  ebayPostage: number;
  totalCost: number;

  // Amazon sale (FBM)
  amazonSalePrice: number;
  amazonReferralFee: number;
  amazonDst: number;
  amazonVatOnFees: number;
  amazonTotalFees: number;
  amazonShipping: number;

  // Results
  netPayout: number;
  totalProfit: number;
  profitMarginPercent: number;
  roiPercent: number;
}

// ============================================
// Scan Results
// ============================================

export interface ScanResult {
  auctionsFound: number;
  auctionsWithSets: number;
  opportunitiesFound: number;
  alertsSent: number;
  joblotsFound: number;
  apiCallsMade: number;
  durationMs: number;
  opportunities: AuctionOpportunity[];
  joblots: JoblotOpportunity[];
  skippedReason?: string;
  error?: string;
}

// ============================================
// Alert History
// ============================================

export interface EbayAuctionAlert {
  id: string;
  userId: string;
  ebayItemId: string;
  ebayTitle: string;
  ebayUrl: string | null;
  ebayImageUrl: string | null;
  setNumber: string | null;
  setName: string | null;
  currentBidGbp: number;
  postageGbp: number;
  totalCostGbp: number;
  bidCount: number;
  amazonPriceGbp: number | null;
  amazon90dAvgGbp: number | null;
  amazonAsin: string | null;
  amazonSalesRank: number | null;
  profitGbp: number | null;
  marginPercent: number | null;
  roiPercent: number | null;
  alertTier: string;
  isJoblot: boolean;
  joblotSets: JoblotSetEntry[] | null;
  auctionEndTime: string | null;
  discordSent: boolean;
  discordSentAt: string | null;
  createdAt: string;
}

// ============================================
// Scan Log
// ============================================

export interface EbayAuctionScanLog {
  id: string;
  userId: string;
  auctionsFound: number;
  auctionsWithSets: number;
  opportunitiesFound: number;
  alertsSent: number;
  joblotsFound: number;
  durationMs: number | null;
  apiCallsMade: number;
  errorMessage: string | null;
  skippedReason: string | null;
  createdAt: string;
}

// ============================================
// API Response Types
// ============================================

export interface AuctionStatusResponse {
  config: EbayAuctionConfig;
  lastScan: EbayAuctionScanLog | null;
  todayStats: {
    scansRun: number;
    opportunitiesFound: number;
    alertsSent: number;
    joblotsFound: number;
  };
  isInQuietHours: boolean;
}

export interface AuctionAlertsResponse {
  alerts: EbayAuctionAlert[];
  totalCount: number;
  hasMore: boolean;
}
