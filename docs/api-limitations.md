# API Limitations

This document describes known API limitations that affect feature implementation.

## BrickLink API

### Seller ID Anonymization

**Affected Feature:** Per-ASIN minimum BL price override
**Discovery Date:** 2026-01-28

#### Problem

BrickLink's Price Guide API returns anonymized seller data. The `price_detail` array does not include seller IDs or any identifying information beyond:
- `quantity` - number of items in lot
- `unit_price` - price per item
- `seller_country_code` - seller's country code

This makes it impossible to:
- Identify specific problematic sellers (e.g., high minimum spend stores)
- Exclude specific sellers from price calculations
- Track seller-specific pricing patterns

#### Impact

When BrickLink returns artificially low prices from sellers with:
- High minimum order requirements (e.g., "minimum order 100+")
- High shipping costs not reflected in item price
- Bulk-only quantities not suitable for resale

These low prices skew the COG% calculation, making some products appear more profitable than they are in practice.

#### Workaround Implemented

Instead of per-seller exclusions, we implemented **per-ASIN minimum BL price override**:

1. User can set a `min_bl_price_override` value for any ASIN
2. The effective BL price becomes: `MAX(actual_bl_min, override)`
3. COG% calculations use the effective price, not the raw minimum

This allows users to manually correct for known data quality issues on specific products without needing seller-level data.

#### Implementation Details

- Database: `asin_bricklink_mapping.min_bl_price_override` column
- API: `PATCH /api/arbitrage/[asin]` with `action: 'setOverride'`
- UI: Override input in ArbitrageDetailModal with save/clear buttons
- View: `arbitrage_current_view.effective_bl_price` calculation

#### Alternative Approaches Considered

1. **Global seller blocklist** - Not possible without seller IDs
2. **Price outlier filtering** - Risk of excluding legitimate deals
3. **Minimum lot quantity filter** - Could miss some valid data
4. **Country-based filtering** - Too broad, would exclude good data

The per-ASIN override was chosen as it gives users precise control over specific problematic items while preserving all other price data.

---

## Amazon SP-API

### Rate Limits

The Amazon SP-API has strict rate limits that affect pricing sync:
- Product Pricing API: ~30 seconds between requests for complete data
- Catalog API: Similar throttling applies

This means automated pricing sync runs via scheduled cron jobs (typically early morning) rather than on-demand.

### Data Freshness

Due to rate limits, Amazon pricing data may be up to 24 hours old. The sync status display shows the actual `lastRunAt` timestamp so users can gauge data freshness.

---

## eBay Browse API

### Regional Limitations

eBay Browse API searches are region-specific. The arbitrage tracker currently queries:
- Country: GB (Great Britain)
- Condition: New

This may miss listings from European sellers shipping to UK.

---

*Last Updated: 2026-01-28*
