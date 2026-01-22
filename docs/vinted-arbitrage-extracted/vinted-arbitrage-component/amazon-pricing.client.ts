// apps/web/src/lib/amazon/amazon-pricing.client.ts
// Amazon SP-API Pricing Client - fetches Buy Box and Was Price data

import { AmazonBaseClient } from './amazon-base.client';

interface AmazonCredentials {
  refreshToken: string;
  sellerId: string;
  marketplaceId: string;
  clientId: string;
  clientSecret: string;
}

interface CompetitivePricingProduct {
  asin: string;
  buyBoxPrice: number | null;
  lowestPrice: number | null;
  listPrice: number | null;         // "Was Price" / RRP
  numberOfOffers: number;
  buyBoxWinner: string | null;      // Seller ID of buy box winner
  isYourBuyBox: boolean;
  condition: string;
}

interface PricingOffer {
  sellerId: string;
  condition: string;
  subCondition: string;
  fulfillmentType: 'AFN' | 'MFN';   // FBA or Merchant Fulfilled
  listingPrice: number;
  shippingPrice: number;
  totalPrice: number;
  isPrime: boolean;
  isFeaturedMerchant: boolean;
  isBuyBoxWinner: boolean;
}

interface ItemPricing {
  asin: string;
  buyBoxPrice: number | null;
  buyBoxSellerId: string | null;
  lowestPrice: number | null;
  listPrice: number | null;         // Manufacturer's suggested retail price
  wasPrice: number | null;          // Previous price (for deals)
  offers: PricingOffer[];
  numberOfOffers: number;
}

export class AmazonPricingClient extends AmazonBaseClient {
  private marketplaceId: string;
  private sellerId: string;

  constructor(credentials: AmazonCredentials) {
    super(credentials);
    this.marketplaceId = credentials.marketplaceId || 'A1F83G8C2ARO7P'; // UK
    this.sellerId = credentials.sellerId;
  }

  /**
   * Get competitive pricing for a list of ASINs
   * Uses SP-API Product Pricing API
   * 
   * @param asins - List of ASINs to fetch pricing for (max 20 per request)
   */
  async getCompetitivePricing(asins: string[]): Promise<CompetitivePricingProduct[]> {
    const results: CompetitivePricingProduct[] = [];
    
    // Process in batches of 20 (API limit)
    const batches = this.chunkArray(asins, 20);
    
    for (const batch of batches) {
      const params = new URLSearchParams({
        MarketplaceId: this.marketplaceId,
        ItemType: 'Asin',
      });
      
      // Add each ASIN as a separate parameter
      batch.forEach((asin, i) => {
        params.append(`Asins`, asin);
      });
      
      try {
        const response = await this.request(
          'GET',
          `/products/pricing/v0/competitivePrice?${params.toString()}`
        );
        
        if (response.payload) {
          for (const product of response.payload) {
            const pricing = this.parseCompetitivePricing(product);
            if (pricing) results.push(pricing);
          }
        }
      } catch (error) {
        console.error('Error fetching competitive pricing:', error);
        // Continue with other batches
      }
      
      // Rate limiting pause
      await this.sleep(200);
    }
    
    return results;
  }

  /**
   * Get item offers (all offers for a single ASIN)
   * Includes detailed offer information including Buy Box status
   * 
   * @param asin - ASIN to fetch offers for
   */
  async getItemOffers(asin: string): Promise<ItemPricing | null> {
    const params = new URLSearchParams({
      MarketplaceId: this.marketplaceId,
      ItemCondition: 'New',
    });
    
    try {
      const response = await this.request(
        'GET',
        `/products/pricing/v0/items/${asin}/offers?${params.toString()}`
      );
      
      if (response.payload) {
        return this.parseItemOffers(asin, response.payload);
      }
    } catch (error) {
      console.error(`Error fetching offers for ${asin}:`, error);
    }
    
    return null;
  }

  /**
   * Batch get item offers for multiple ASINs
   */
  async getBatchItemOffers(asins: string[]): Promise<ItemPricing[]> {
    const results: ItemPricing[] = [];
    
    // Can only fetch one ASIN at a time with getItemOffers
    for (const asin of asins) {
      const pricing = await this.getItemOffers(asin);
      if (pricing) results.push(pricing);
      
      // Rate limiting - 0.5 second between requests
      await this.sleep(500);
    }
    
    return results;
  }

  /**
   * Get pricing for items by SKU (your listings)
   * Useful for checking your current prices vs buy box
   */
  async getMyPricing(skus: string[]): Promise<Map<string, { yourPrice: number; buyBoxPrice: number | null }>> {
    const results = new Map<string, { yourPrice: number; buyBoxPrice: number | null }>();
    
    const batches = this.chunkArray(skus, 20);
    
    for (const batch of batches) {
      const params = new URLSearchParams({
        MarketplaceId: this.marketplaceId,
        ItemType: 'Sku',
      });
      
      batch.forEach(sku => params.append('Skus', sku));
      
      try {
        const response = await this.request(
          'GET',
          `/products/pricing/v0/price?${params.toString()}`
        );
        
        if (response.payload) {
          for (const item of response.payload) {
            if (item.status === 'Success' && item.Product?.Offers?.[0]) {
              const offer = item.Product.Offers[0];
              const sku = item.SellerSKU;
              
              results.set(sku, {
                yourPrice: parseFloat(offer.BuyingPrice?.ListingPrice?.Amount || '0'),
                buyBoxPrice: offer.BuyBox?.BuyingPrice?.ListingPrice?.Amount 
                  ? parseFloat(offer.BuyBox.BuyingPrice.ListingPrice.Amount)
                  : null,
              });
            }
          }
        }
      } catch (error) {
        console.error('Error fetching my pricing:', error);
      }
      
      await this.sleep(200);
    }
    
    return results;
  }

  // ================== Private Helpers ==================

  private parseCompetitivePricing(product: any): CompetitivePricingProduct | null {
    if (product.status !== 'Success') return null;
    
    const asin = product.ASIN;
    const competitivePrice = product.Product?.CompetitivePricing;
    
    if (!competitivePrice) return null;
    
    // Find buy box price
    let buyBoxPrice: number | null = null;
    let lowestPrice: number | null = null;
    
    const prices = competitivePrice.CompetitivePrices || [];
    for (const price of prices) {
      const amount = parseFloat(price.Price?.ListingPrice?.Amount || '0');
      
      if (price.CompetitivePriceId === '1') {
        // Buy box price
        buyBoxPrice = amount;
      } else if (price.CompetitivePriceId === '2') {
        // Lowest new price
        lowestPrice = amount;
      }
    }
    
    // Get list price (RRP / Was Price)
    const listPrice = competitivePrice.ListPrice?.Amount
      ? parseFloat(competitivePrice.ListPrice.Amount)
      : null;
    
    // Get number of offers
    const offerCounts = competitivePrice.NumberOfOfferListings || [];
    let numberOfOffers = 0;
    for (const count of offerCounts) {
      if (count.condition === 'New') {
        numberOfOffers = count.Count || 0;
        break;
      }
    }
    
    // Check if you own the buy box
    const tradeInValue = competitivePrice.TradeInValue;
    
    return {
      asin,
      buyBoxPrice,
      lowestPrice: lowestPrice || buyBoxPrice,
      listPrice,
      numberOfOffers,
      buyBoxWinner: null, // Not available in competitive pricing
      isYourBuyBox: false, // Would need to cross-reference with your seller ID
      condition: 'New',
    };
  }

  private parseItemOffers(asin: string, payload: any): ItemPricing {
    const offers: PricingOffer[] = [];
    let buyBoxPrice: number | null = null;
    let buyBoxSellerId: string | null = null;
    let lowestPrice: number | null = null;
    let listPrice: number | null = null;
    
    // Parse summary
    const summary = payload.Summary;
    if (summary) {
      // Buy box price from summary
      if (summary.BuyBoxPrices?.[0]) {
        const bbPrice = summary.BuyBoxPrices[0];
        buyBoxPrice = parseFloat(bbPrice.ListingPrice?.Amount || '0') +
                      parseFloat(bbPrice.Shipping?.Amount || '0');
      }
      
      // Lowest price from summary
      if (summary.LowestPrices?.[0]) {
        const lowPrice = summary.LowestPrices[0];
        lowestPrice = parseFloat(lowPrice.ListingPrice?.Amount || '0') +
                      parseFloat(lowPrice.Shipping?.Amount || '0');
      }
      
      // List price (RRP)
      if (summary.ListPrice) {
        listPrice = parseFloat(summary.ListPrice.Amount);
      }
    }
    
    // Parse individual offers
    const rawOffers = payload.Offers || [];
    for (const offer of rawOffers) {
      const listingPrice = parseFloat(offer.ListingPrice?.Amount || '0');
      const shippingPrice = parseFloat(offer.Shipping?.Amount || '0');
      const totalPrice = listingPrice + shippingPrice;
      
      const parsedOffer: PricingOffer = {
        sellerId: offer.SellerId,
        condition: offer.SubCondition || 'New',
        subCondition: offer.SubCondition || '',
        fulfillmentType: offer.IsFulfilledByAmazon ? 'AFN' : 'MFN',
        listingPrice,
        shippingPrice,
        totalPrice,
        isPrime: offer.PrimeInformation?.IsPrime || false,
        isFeaturedMerchant: offer.IsFeaturedMerchant || false,
        isBuyBoxWinner: offer.IsBuyBoxWinner || false,
      };
      
      offers.push(parsedOffer);
      
      // Track buy box winner
      if (parsedOffer.isBuyBoxWinner) {
        buyBoxSellerId = parsedOffer.sellerId;
        buyBoxPrice = parsedOffer.totalPrice;
      }
      
      // Track lowest price
      if (lowestPrice === null || totalPrice < lowestPrice) {
        lowestPrice = totalPrice;
      }
    }
    
    return {
      asin,
      buyBoxPrice,
      buyBoxSellerId,
      lowestPrice,
      listPrice,
      wasPrice: listPrice, // Was price is typically the list price
      offers,
      numberOfOffers: offers.length,
    };
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
