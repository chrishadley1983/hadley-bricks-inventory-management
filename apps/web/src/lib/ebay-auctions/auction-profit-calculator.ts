/**
 * eBay Auction Profit Calculator
 *
 * Calculates profit from buying on eBay auction and selling on Amazon FBM.
 * Uses same fee structure as existing Amazon FBM calculations.
 */

import type { AuctionProfitBreakdown } from './types';

// Amazon FBM UK Fee Constants (2026)
const AMAZON_REFERRAL_FEE_RATE = 0.15;
const AMAZON_DST_RATE = 0.02;
const VAT_RATE = 0.2;
const SHIPPING_THRESHOLD = 14.0;
const SHIPPING_COST_LOW = 3.0;
const SHIPPING_COST_HIGH = 4.0;

/**
 * Calculate profit from buying at eBay auction price and selling on Amazon FBM.
 *
 * @param currentBid - Current/winning bid price on eBay
 * @param ebayPostage - Postage cost from eBay seller
 * @param amazonSalePrice - Expected Amazon sale price (buy box or equivalent)
 */
export function calculateAuctionProfit(
  currentBid: number,
  ebayPostage: number,
  amazonSalePrice: number
): AuctionProfitBreakdown | null {
  if (currentBid <= 0 || amazonSalePrice <= 0) {
    return null;
  }

  const totalCost = currentBid + ebayPostage;

  // Amazon fees
  const amazonReferralFee = amazonSalePrice * AMAZON_REFERRAL_FEE_RATE;
  const amazonDst = amazonReferralFee * AMAZON_DST_RATE;
  const subtotalFee = amazonReferralFee + amazonDst;
  const amazonVatOnFees = subtotalFee * VAT_RATE;
  const amazonTotalFees = subtotalFee + amazonVatOnFees;

  // Amazon shipping
  const amazonShipping = amazonSalePrice < SHIPPING_THRESHOLD ? SHIPPING_COST_LOW : SHIPPING_COST_HIGH;

  // Profit
  const netPayout = amazonSalePrice - amazonTotalFees - amazonShipping;
  const totalProfit = netPayout - totalCost;
  const profitMarginPercent = (totalProfit / amazonSalePrice) * 100;
  const roiPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  return {
    currentBid,
    ebayPostage,
    totalCost,
    amazonSalePrice,
    amazonReferralFee,
    amazonDst,
    amazonVatOnFees,
    amazonTotalFees,
    amazonShipping,
    netPayout,
    totalProfit,
    profitMarginPercent,
    roiPercent,
  };
}
