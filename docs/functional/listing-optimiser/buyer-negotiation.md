# Buyer Negotiation (Offers Tab)

## Overview

The Buyer Negotiation feature allows you to send targeted discount offers to eBay buyers who have shown interest in your listings through actions like watching items or adding them to cart. This proactive approach can convert interested browsers into buyers.

## Accessing Buyer Negotiation

**Navigation**: Dashboard sidebar → Listing Optimiser → Offers tab

## Key Concepts

### Eligible Buyers

eBay tracks buyers who have shown interest in your listings:
- **Watchers**: Buyers who added your item to their watch list
- **Cart additions**: Buyers who added your item to their cart
- **Best Offer viewers**: Buyers who viewed your Best Offer options

### Discount Rules

Configure automatic discount percentages based on listing quality scores:

| Score Range | Suggested Discount | Rationale |
|-------------|-------------------|-----------|
| 80-100 | 5-10% | High-quality listings need smaller discounts |
| 60-79 | 10-15% | Medium quality may need moderate incentive |
| 40-59 | 15-20% | Lower quality listings need stronger offers |

### Automation Schedule

When enabled, offers are sent automatically at optimal times:
- **8:00 AM** - Morning shoppers
- **12:00 PM** - Lunch browsers
- **4:00 PM** - Afternoon activity
- **8:00 PM** - Evening peak

All times are UK time.

## User Interface

### Metrics Dashboard

Shows performance over the last 30 days:

| Metric | Description |
|--------|-------------|
| **Offers Sent** | Total offers dispatched |
| **Accepted** | Offers that resulted in sales |
| **Declined** | Offers rejected by buyers |
| **Expired** | Offers that timed out |
| **Acceptance Rate** | Percentage of accepted offers |

### Planned Offers Table

Lists items eligible for offers:

| Column | Description |
|--------|-------------|
| Checkbox | Select for manual offer sending |
| Image | Listing thumbnail |
| Title | Listing title |
| Price | Current listing price |
| Interested | Number of interested buyers |
| Discount | Calculated discount percentage |
| Offer Price | Price after discount |

### Recent Offers Table

Shows recently sent offers:

| Column | Description |
|--------|-------------|
| Listing | Item that received offer |
| Buyer | Recipient (anonymized) |
| Original Price | Pre-discount price |
| Offer Price | Discounted price |
| Status | Sent, Accepted, Declined, Expired |
| Sent At | When offer was dispatched |

## Workflow

### Manual Offer Sending

1. Navigate to Listing Optimiser → Offers tab
2. Review the Planned Offers table
3. Select listings using checkboxes
4. Click **Send Offers** button
5. System sends offers to interested buyers
6. View results in Recent Offers table

### Automatic Offer Sending

1. Click **Settings** button
2. Enable **Automation**
3. Configure discount rules
4. Save settings
5. System automatically sends offers 4x daily

## Configuration

### Settings Modal

Click **Settings** to configure:

#### General Settings

| Setting | Description |
|---------|-------------|
| **Automation Enabled** | Toggle automatic offer sending |
| **Message Template** | Custom message included with offers |
| **Min Listing Age** | Only send to listings older than X days |
| **Max Offers Per Day** | Limit total daily offers |

#### Discount Rules

Create rules that map quality scores to discount percentages:

```
Score 80-100 → 5% discount
Score 60-79  → 10% discount
Score 40-59  → 15% discount
Score 0-39   → 20% discount
```

**Adding a Rule:**
1. Click **Add Rule**
2. Enter minimum score
3. Enter maximum score
4. Enter discount percentage
5. Click **Save**

**Note**: Rules cannot overlap. Each score can only match one rule.

## Offer Eligibility

An item is eligible for offers when:

1. **Has interested buyers** - Watchers or cart additions
2. **Has quality score** - Must be analysed first
3. **Matches discount rule** - Score maps to a discount percentage
4. **Not recently offered** - Cooldown period respected
5. **Best Offer enabled** - Listing accepts offers

## Technical Details

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/negotiation/config` | GET/PUT | Get/update configuration |
| `/api/negotiation/metrics` | GET | Fetch performance metrics |
| `/api/negotiation/offers` | GET | List recent offers |
| `/api/negotiation/eligible` | GET | List eligible items |
| `/api/negotiation/send` | POST | Send offers to selected items |
| `/api/negotiation/rules` | GET/POST | Manage discount rules |
| `/api/negotiation/rules/[id]` | PUT/DELETE | Update/delete rule |

### Database Tables

```sql
-- Configuration
CREATE TABLE negotiation_config (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  automation_enabled BOOLEAN DEFAULT FALSE,
  message_template TEXT,
  min_listing_age_days INTEGER DEFAULT 7,
  max_offers_per_day INTEGER DEFAULT 50,
  last_auto_run_at TIMESTAMP
);

-- Discount Rules
CREATE TABLE negotiation_discount_rules (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  min_score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  discount_percentage DECIMAL NOT NULL
);

-- Sent Offers (tracking)
CREATE TABLE negotiation_offers (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  ebay_listing_id VARCHAR NOT NULL,
  buyer_id VARCHAR,
  original_price DECIMAL NOT NULL,
  offer_price DECIMAL NOT NULL,
  discount_percentage DECIMAL NOT NULL,
  status VARCHAR NOT NULL,
  sent_at TIMESTAMP DEFAULT NOW(),
  responded_at TIMESTAMP
);
```

### eBay API Integration

Uses eBay's Negotiation API:
- `sendOfferToInterestedBuyers` - Send offer to interested buyers
- Requires OAuth scope: `https://api.ebay.com/oauth/api_scope/sell.negotiation`

## Best Practices

1. **Start conservative** - Begin with smaller discounts (5-10%)
2. **Monitor acceptance rates** - Adjust discounts based on results
3. **Use quality scores** - Lower discounts for high-quality listings
4. **Respect cooldowns** - Don't spam buyers with repeated offers
5. **Personalize messages** - Custom templates convert better

## Troubleshooting

### "No eligible listings"
- Ensure listings have been analysed (quality score required)
- Check that discount rules are configured
- Verify listings have interested buyers

### Offers not sending
- Check eBay connection status
- Verify OAuth scopes include negotiation
- Review error messages in toast notifications

### Low acceptance rate
- Try larger discounts
- Improve listing quality first
- Check competitor pricing

### Automation not running
- Verify automation is enabled in settings
- Check `last_auto_run_at` timestamp
- Review server logs for cron errors

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/features/negotiation/OffersTab.tsx` | Main UI |
| `apps/web/src/hooks/useNegotiation.ts` | React Query hooks |
| `apps/web/src/lib/ebay/negotiation.service.ts` | Business logic |
| `apps/web/src/lib/ebay/negotiation-scoring.service.ts` | Discount calculation |
| `apps/web/src/app/api/negotiation/` | API routes |

## Related Documentation

- [Listing Optimiser Overview](./overview.md) - Parent feature
- [eBay Integration](../ebay/overview.md) - eBay connectivity
- [AI Analysis](../ebay/listing-optimiser.md) - Quality scoring details
