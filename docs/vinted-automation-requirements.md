# Vinted Arbitrage Automation - Requirements Specification

> **Feature:** Automated Vinted LEGO Arbitrage Scanner
> **Status:** Requirements Complete
> **Date:** 2026-01-21

---

## ⚠️ CRITICAL: Account Protection

**The user's Vinted account is a business-critical asset. A ban would significantly impact sourcing capability. Every design decision, implementation choice, and testing approach MUST prioritise account safety above all other considerations including feature completeness and scanning frequency.**

**Implementation teams must:**
1. Flag ANY concerns about detection risk during development
2. Err on the side of caution with timing and behaviour patterns
3. Document risk assessments for each component
4. Implement conservative defaults that can be relaxed later
5. Never proceed if uncertain about safety implications

---

## 1. Overview

### 1.1 Purpose

Automate the existing manual Vinted arbitrage workflow (`/arbitrage/vinted`) to continuously scan for mispriced LEGO sets, calculate profitability against Amazon selling prices, and alert the user to buying opportunities via push notifications.

### 1.2 Goals

- Identify arbitrage opportunities before competitors
- Systematic coverage of known profitable sets
- **Minimise risk of Vinted account ban through human-like behaviour**
- Provide actionable alerts with profit calculations
- Full visibility into scanner operation via dashboard UI

### 1.3 Non-Goals

- Automated purchasing (user decides and acts manually)
- Multi-account scanning
- Other platforms beyond Vinted (for this feature)
- High-frequency scanning that risks detection

---

## 2. Technical Architecture

### 2.1 Approach Selection

**Selected:** Claude Code + Chrome Extension

| Approach | Verdict | Reason |
|----------|---------|--------|
| Lobstr.io | ❌ Rejected | Per-result pricing uneconomical (~9% signal in search results) |
| Direct server scraping | ❌ Rejected | DataDome detection, Terms violation, ban risk |
| Claude Code + Chrome | ✅ Selected | Uses real browser session, residential IP, authentic fingerprint |

### 2.2 Why This Approach is Safer

| Factor | Server Scraping | Claude + Real Chrome |
|--------|-----------------|----------------------|
| IP Address | Data centre (flagged) | Residential (trusted) |
| TLS Fingerprint | Python/Node (detectable) | Real Chrome (authentic) |
| Browser Fingerprint | Headless markers | Genuine browser |
| Cookies/Session | None or forged | Real logged-in session |
| JavaScript Execution | None or emulated | Full V8 engine |
| Mouse/Keyboard Events | None | Can simulate naturally |
| Request Timing | Programmatic patterns | Human-like variation |

### 2.3 How It Works

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cron Job  │────▶│  Claude Code    │────▶│  Real Chrome    │
│  (schedule) │     │  (--chrome -p)  │     │  + Extension    │
└─────────────┘     └─────────────────┘     └─────────────────┘
                                                     │
                                                     ▼
                                            ┌─────────────────┐
                                            │    Vinted.co.uk │
                                            │  (normal user)  │
                                            └─────────────────┘
```

**Requirements:**
- Machine must be powered on during operating hours
- Chrome running with "Claude in Chrome" extension active
- Paid Claude plan for API access

### 2.4 Data Extraction Method

- **Method:** HTML/DOM parsing via JavaScript execution
- **Not:** Screenshot/vision analysis
- **Rationale:** Deterministic, fast, exact data extraction
- **Implementation:** `document.querySelectorAll()` on loaded page
- **Maintenance:** Selectors stored in configuration for easy updates
- **Safety Note:** DOM reading is local operation, adds no network requests

---

## 3. DataDome Protection - Detailed Analysis

### 3.1 What is DataDome?

DataDome is an enterprise bot detection service used by Vinted to identify and block automated access. It uses machine learning to analyse multiple signals and build a risk score for each session.

### 3.2 Detection Vectors

#### 3.2.1 Technical Fingerprinting (LOW RISK with our approach)

| Signal | What They Check | Our Status |
|--------|-----------------|------------|
| **TLS/JA3 Fingerprint** | SSL handshake characteristics unique to each HTTP client | ✅ Real Chrome = authentic |
| **IP Reputation** | Data centre IPs, VPNs, known proxy services | ✅ Residential IP = trusted |
| **Browser Fingerprint** | Canvas, WebGL, fonts, plugins, screen size | ✅ Real browser = authentic |
| **Headless Detection** | `navigator.webdriver`, missing plugins, Chrome DevTools Protocol markers | ✅ Not headless = undetectable |
| **User Agent** | Consistency between UA string and actual browser behaviour | ✅ Real Chrome = consistent |

#### 3.2.2 Behavioural Analysis (REQUIRES ACTIVE MITIGATION)

| Signal | What They Check | Risk Level | Mitigation |
|--------|-----------------|------------|------------|
| **Request Timing** | Exact intervals between requests (e.g., exactly 5.000s) | 🔴 HIGH | Randomise all delays |
| **Session Patterns** | Same searches at same times daily | 🔴 HIGH | Shuffle order, vary schedule |
| **Query Patterns** | Identical search queries in sequence | 🟡 MEDIUM | Randomise search order |
| **Navigation Depth** | Always viewing exactly N pages | 🟡 MEDIUM | Vary pages 1-3 |
| **Interaction Absence** | No scrolling, no hovers, no clicks except targets | 🟡 MEDIUM | Add natural interactions |
| **Mouse Movement** | No mouse movement data | 🟡 MEDIUM | Consider mouse simulation |
| **Request Velocity** | Too many requests per hour | 🔴 HIGH | Conservative rate limits |
| **Geographic Anomalies** | IP location vs. account location mismatch | ✅ LOW | Same location |

#### 3.2.3 Session Integrity

| Signal | What They Check | Our Status |
|--------|-----------------|------------|
| **Cookie Consistency** | Same session cookies across requests | ✅ Real browser maintains |
| **Referrer Chain** | Logical navigation path | ✅ Real navigation |
| **JavaScript Execution** | JS challenges completed | ✅ Real V8 engine |

### 3.3 DataDome Response Patterns

When DataDome suspects automation:

1. **Soft Challenge:** CAPTCHA presented (solvable, but a warning sign)
2. **Hard Block:** 403 Forbidden with DataDome signature
3. **Shadow Ban:** Results degraded/delayed without obvious blocking
4. **Account Flag:** Increased scrutiny on all future requests

**Critical:** If we ever see a CAPTCHA during automated scanning, this is an early warning. Scanning should pause and the user should be alerted immediately.

### 3.4 Vinted-Specific Considerations

| Factor | Detail |
|--------|--------|
| **Terms of Service** | Explicitly prohibits scraping and automated access |
| **Account Linking** | Device IDs, payment methods, IP history all linked |
| **Ban Scope** | Account ban may extend to all associated profiles |
| **Appeal Process** | Limited; automation bans rarely overturned |

### 3.5 Our Mitigation Strategy

#### Timing Randomisation

```
Base interval: 4 minutes between watchlist searches
Randomised: 2-8 minutes (uniform distribution)
Additional jitter: ±30 seconds

Broad sweep hourly window: Random 0-55 minutes into each hour
Never: Exact intervals like 5:00, 10:00, 15:00
```

#### Search Order Randomisation

```
Daily: Shuffle complete watchlist order
Never: Same sequence two days in a row
Clustering: Allow natural groupings (2-3 searches closer together, then gap)
```

#### Interaction Variation

```
Pages scrolled: 1-3 per broad sweep (weighted: 2 pages most common)
Scroll behaviour: Variable speed, occasional pause
Filter interaction: 10% chance to toggle a filter then toggle back
Dwell time: 3-10 seconds on page before extracting data
```

#### Volume Limits

```
Broad sweeps: Maximum 14/day (once per hour, operating hours only)
Watchlist: 200 sets across 14 hours = ~14 sets/hour = very low velocity
Total page loads: ~214/day maximum
Compare to manual user: Could easily do 100+ searches in active session
Our pattern: Spread thin across entire day = LOW suspicion
```

### 3.6 Risk Assessment Summary

| Risk Category | Level | Justification |
|---------------|-------|---------------|
| Technical Detection | ✅ VERY LOW | Real browser, real IP, real session |
| Behavioural Detection | 🟡 LOW | With all mitigations implemented |
| Volume-Based Detection | ✅ VERY LOW | 214 pages/day is modest |
| Pattern Detection | 🟡 LOW | Randomisation prevents patterns |
| **Overall Risk** | ✅ **LOW** | Looks like keen LEGO buyer |

### 3.7 Implementation Safety Requirements

**MANDATORY for any implementation:**

1. **Randomisation is not optional** - Every timing value must have variance
2. **CAPTCHA detection must halt scanning** - Implement detection and auto-pause
3. **Logging for audit** - Record all timings for pattern analysis
4. **Conservative defaults** - Ship with longer delays; optimise later if safe
5. **Kill switch** - Instant pause capability if issues detected
6. **Gradual rollout** - Start with reduced frequency, increase slowly
7. **Human verification** - User should occasionally log in manually to maintain natural activity

### 3.8 Testing Safety Protocol

**Before any automated scanning:**

1. **Manual baseline:** Document normal manual usage patterns
2. **Single test:** Run ONE automated scan, verify no CAPTCHA
3. **Low frequency test:** Run at 50% planned frequency for 1 week
4. **Monitor for warnings:** Check for any CAPTCHA appearances
5. **Gradual increase:** Only increase frequency if no warnings after 2 weeks

**If any CAPTCHA appears:**
1. STOP all automated scanning immediately
2. Complete CAPTCHA manually
3. Wait 48 hours before any automation
4. Review and increase all timing delays
5. Resume at 25% frequency

---

## 4. Scanning Modes

### 4.1 Mode A: Broad Sweep

**Purpose:** Catch fresh mispriced listings as they appear

| Parameter | Value | Configurable |
|-----------|-------|--------------|
| Frequency | Once per hour | Yes |
| Operating hours | 08:00–22:00 | Yes |
| Search URL | Generic LEGO search, newest first, "New with tags" | Yes |
| Pages scanned | 1–3 (randomised) | Yes |
| COG% threshold | 40% (default) | Yes |

**Search URL:**
```
https://www.vinted.co.uk/catalog?search_text=lego&status_ids[]=6&order=newest_first
```

**Randomisation:**
- Execution time: Random 0–55 minutes into each hour window
- Pages scrolled: Varies between 1–3 per scan
- Occasional filter toggle: 10% chance to interact with filters

**Example day:**
| Hour | Actual time | Pages |
|------|-------------|-------|
| 08:00 | 08:17 | 2 |
| 09:00 | 09:42 | 1 |
| 10:00 | 10:08 | 3 |
| ... | ... | ... |

### 4.2 Mode B: Watchlist Scan

**Purpose:** Systematic coverage of 200 known profitable sets

| Parameter | Value | Configurable |
|-----------|-------|--------------|
| Sets monitored | 200 | Via watchlist |
| Operating hours | 08:00–22:00 (14 hours) | Yes |
| Timing | ~1 set every 4 minutes | Derived |
| Gap between searches | 2–8 minutes (randomised) | Yes |
| COG% threshold | 40% (default) | Yes |

**Search pattern:**
- Individual set searches: "LEGO 75192", "LEGO 10300", etc.
- Order shuffled daily
- Variable gaps create natural clustering

---

## 5. Watchlist Composition

### 5.1 Overview

| Source | Count | Derivation |
|--------|-------|------------|
| Your best sellers | 100 | Top 100 by units sold (Amazon orders, last 13 months) |
| Popular retired sets | 100 | Top 100 by Amazon sales rank, WHERE retired, EXCLUDING best sellers |

**Total:** 200 unique sets (overlap removed)

### 5.2 Best Sellers Query

```sql
SELECT DISTINCT asin
FROM platform_orders o
JOIN platform_order_items i ON o.id = i.order_id
WHERE o.platform = 'amazon'
  AND o.order_date >= NOW() - INTERVAL '13 months'
GROUP BY asin
ORDER BY COUNT(*) DESC
LIMIT 100
```

Map ASINs to set numbers via `amazon_asin_mappings` or `seeded_asins`.

### 5.3 Popular Retired Sets Query

Requires sales rank data (see Section 6).

```sql
WITH best_sellers AS (
  -- As above
),
popular_retired AS (
  SELECT sa.asin, sa.id AS seeded_asin_id, bs.set_number
  FROM seeded_asins sa
  JOIN seeded_asin_rankings sar ON sa.id = sar.seeded_asin_id
  JOIN brickset_sets bs ON sa.brickset_set_id = bs.id
  WHERE sa.discovery_status = 'found'
    AND bs.exit_date IS NOT NULL  -- Retired
    AND sa.asin NOT IN (SELECT asin FROM best_sellers)
  ORDER BY sar.sales_rank ASC
  LIMIT 100
)
SELECT * FROM popular_retired
```

### 5.4 Watchlist Storage

**Table:** `vinted_watchlist`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK to auth.users |
| set_number | text | LEGO set number |
| asin | text | Amazon ASIN |
| source | enum | 'best_seller' or 'popular_retired' |
| sales_rank | integer | Amazon rank (for sorting) |
| created_at | timestamp | When added |
| updated_at | timestamp | Last refresh |

**Refresh:** Monthly automatic, plus ad-hoc manual trigger

---

## 6. Sales Rank Collection

### 6.1 Problem

The `seeded_asins` table contains discovered ASINs but not sales rank data. We need ranks to identify "popular retired sets".

### 6.2 Solution

**New table:** `seeded_asin_rankings`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| seeded_asin_id | uuid | FK to seeded_asins |
| asin | text | Denormalised for convenience |
| sales_rank | integer | Amazon sales rank |
| fetched_at | timestamp | When rank was fetched |

### 6.3 Bootstrap Process

1. Query all retired sets with discovered ASINs (~3,000 estimated)
2. Batch into groups of 20 (SP-API Pricing endpoint limit)
3. Spread ~150 batches over 3 days (~50 batches/day)
4. Store results in `seeded_asin_rankings`

### 6.4 Refresh

- **Automatic:** None (one-time bootstrap for watchlist)
- **Ad-hoc:** Manual trigger via UI or CLI to re-fetch all/subset

---

## 7. Watchlist Effectiveness Tracking

### 7.1 Purpose

Track which watchlist sets actually produce Vinted listings. Sets that never appear on Vinted waste scanning time and should be removed.

### 7.2 Stats Table

**Table:** `vinted_watchlist_stats`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK to auth.users |
| set_number | text | LEGO set number |
| total_scans | integer | Times we've searched for this set |
| listings_found | integer | Total Vinted listings seen |
| viable_found | integer | Listings meeting COG% threshold |
| near_miss_found | integer | Listings in near-miss range |
| last_listing_at | timestamp | Last time ANY listing was found |
| last_viable_at | timestamp | Last time a viable opportunity was found |
| first_scanned_at | timestamp | When we started tracking |
| updated_at | timestamp | |

### 7.3 Flagging Logic

| Condition | Flag | Meaning |
|-----------|------|---------|
| No listings found in 30 days | ⚠️ Stale | Nobody lists this set; consider removal |
| Listings found but no viable in 30 days | 🔶 Low Yield | Set exists but never at good price |
| Viable found in last 7 days | ✅ Active | Working well |

### 7.4 Manual Exclusions

**Table:** `vinted_watchlist_exclusions`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK |
| set_number | text | Excluded set |
| reason | text | Optional note (e.g., "Never on Vinted UK") |
| excluded_at | timestamp | |

Excluded sets are filtered out during watchlist refresh and won't be re-added automatically.

### 7.5 Watchlist Health UI

**Route:** `/arbitrage/vinted/automation/watchlist`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Watchlist Health                                    [Refresh] [Export CSV] │
├─────────────────────────────────────────────────────────────────────────────┤
│  Summary: 200 sets │ ✅ 180 Active │ 🔶 8 Low Yield │ ⚠️ 12 Stale           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Filter: [All ▼]  [Show only: ⚠️ Stale]  [🔶 Low Yield]  [✅ Active]        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Set         │ Name              │ Source      │ Scans │ Found │ Viable │ Last Seen    │ Flag │
├─────────────────────────────────────────────────────────────────────────────┤
│  75192       │ Millennium Falcon │ Best Seller │  42   │   0   │   0    │ Never        │ ⚠️   │
│  10300       │ DeLorean          │ Best Seller │  42   │  15   │   0    │ 3 days ago   │ 🔶   │
│  42141       │ McLaren F1        │ Pop.Retired │  42   │  23   │   4    │ Yesterday    │ ✅   │
│  ...         │                   │             │       │       │        │              │      │
└─────────────────────────────────────────────────────────────────────────────┘
│                                                                              │
│  [Remove Selected]  [Bulk Remove ⚠️ Stale (12)]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.6 Watchlist Health Columns

| Column | Description |
|--------|-------------|
| Set | Number (link to Set Lookup) |
| Name | Set name from Brickset |
| Source | "Best Seller" or "Popular Retired" |
| Scans | Total times we've searched for this set |
| Found | Total Vinted listings ever seen |
| Viable | Count meeting COG% threshold |
| Last Seen | When we last found ANY listing for this set |
| Flag | ⚠️ Stale / 🔶 Low Yield / ✅ Active |

### 7.7 Watchlist Health Actions

| Action | Effect |
|--------|--------|
| **Remove** | Add to exclusions, remove from active watchlist |
| **Bulk Remove Stale** | Remove all ⚠️ flagged sets at once |
| **Export CSV** | Download full stats for external analysis |
| **Refresh Stats** | Recalculate flags based on current data |

---

## 8. Alert System

### 8.1 Delivery Method

**Pushover** (existing integration)

- Service: `pushover.service.ts`
- Config: Environment variables `PUSHOVER_USER_KEY`, `PUSHOVER_API_TOKEN`
- Graceful degradation: Silent skip if not configured

### 8.2 New Method

```typescript
async sendVintedOpportunity(params: {
  setNumber: string;
  setName: string;
  vintedPrice: number;
  amazonPrice: number;
  cogPercent: number;
  estimatedProfit: number;
  vintedUrl: string;
}): Promise<PushoverResult>
```

**Priority:** High (1) with sound for excellent opportunities (COG% < 30%), Normal (0) otherwise

### 8.3 Alert Timing

- **Immediate:** Alert fires the moment a viable listing is found
- **Rationale:** Speed matters when competing for mispriced listings

### 8.4 Daily Summary

Push notification at end of operating hours:
```
Vinted Scanner Summary
━━━━━━━━━━━━━━━━━━━━━━
Broad sweeps: 14
Watchlist scans: 200
Opportunities found: 3
Near misses: 7
```

### 8.5 Safety Alerts

**CAPTCHA Detection Alert (HIGH PRIORITY):**
```
⚠️ Vinted Scanner Paused
━━━━━━━━━━━━━━━━━━━━━━
CAPTCHA detected during scan.
Automated scanning has been paused.
Please review before resuming.
```

---

## 9. Error Handling

### 9.1 Scan Failures

| Scenario | Handling |
|----------|----------|
| Page doesn't load | Silent retry on next scheduled run |
| DataDome blocks | Silent retry, increment failure counter |
| CAPTCHA detected | **IMMEDIATE PAUSE**, alert user |
| 3 consecutive failures | Pushover alert to user |

### 9.2 Health Monitoring

**Consecutive failure tracking:**

```typescript
interface ScanHealth {
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastErrorMessage: string | null;
  captchaDetected: boolean;
  pausedAt: Date | null;
  pauseReason: string | null;
}
```

**Alert thresholds:**
- 3 consecutive failures → High priority Pushover alert
- CAPTCHA detected → Immediate pause + high priority alert

---

## 10. Configuration

### 10.1 User-Configurable Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Mode A COG% threshold | 40% | Alert threshold for broad sweep |
| Mode B COG% threshold | 40% | Alert threshold for watchlist |
| Near-miss threshold | 50% | Upper bound for "near miss" display |
| Operating hours start | 08:00 | When scanning begins |
| Operating hours end | 22:00 | When scanning stops |
| Scanner enabled | true | Master on/off switch |

### 10.2 Storage

**Table:** `vinted_scanner_config`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK to auth.users (unique) |
| enabled | boolean | Master switch |
| paused | boolean | Temporary pause (e.g., after CAPTCHA) |
| pause_reason | text | Why paused |
| broad_sweep_cog_threshold | integer | % |
| watchlist_cog_threshold | integer | % |
| near_miss_threshold | integer | % |
| operating_hours_start | time | HH:MM |
| operating_hours_end | time | HH:MM |
| created_at | timestamp | |
| updated_at | timestamp | |

---

## 11. Database Schema Summary

### 11.1 New Tables

| Table | Purpose |
|-------|---------|
| `vinted_scanner_config` | User settings and pause state |
| `vinted_watchlist` | Materialised 200-set watchlist |
| `vinted_watchlist_stats` | Per-set effectiveness tracking |
| `vinted_watchlist_exclusions` | Manually excluded sets |
| `seeded_asin_rankings` | Amazon sales rank for seeded ASINs |
| `vinted_scan_log` | Audit log of all scans |
| `vinted_opportunities` | Found opportunities and near-misses |

### 11.2 Table: vinted_scan_log

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK to auth.users |
| scan_type | enum | 'broad_sweep' or 'watchlist' |
| set_number | text | NULL for broad sweep |
| started_at | timestamp | |
| completed_at | timestamp | |
| status | enum | 'success', 'failed', 'partial', 'captcha' |
| listings_found | integer | Total listings scanned |
| opportunities_found | integer | Meets threshold |
| error_message | text | If failed |
| timing_delay_ms | integer | Actual delay used (for audit) |

### 11.3 Table: vinted_opportunities

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK to auth.users |
| scan_log_id | uuid | FK to vinted_scan_log |
| vinted_listing_id | text | Vinted's listing ID |
| vinted_url | text | Full URL |
| set_number | text | Extracted LEGO set |
| set_name | text | From Brickset |
| vinted_price | decimal | Listed price |
| amazon_price | decimal | Buy Box or lowest |
| cog_percent | decimal | Calculated COG% |
| estimated_profit | decimal | After fees |
| is_viable | boolean | Meets threshold |
| status | enum | 'active', 'purchased', 'expired', 'dismissed' |
| listed_at | timestamp | When Vinted listing was created |
| found_at | timestamp | When we discovered it |
| expires_at | timestamp | found_at + 7 days |

---

## 12. UI Specification

### 12.1 Page Location

**Route:** `/arbitrage/vinted/automation`

**Navigation:** Arbitrage → Vinted → Automation tab (alongside existing manual scan)

**Sub-routes:**
- `/arbitrage/vinted/automation` - Main dashboard (default)
- `/arbitrage/vinted/automation/watchlist` - Watchlist health view

### 12.2 Main Dashboard Sections

#### Scanner Status Card

```
┌─────────────────────────────────────────────────────────────────────┐
│  Vinted Scanner                                    [Pause] [Scan Now]│
├─────────────────────────────────────────────────────────────────────┤
│  Status: ● Running                                                   │
│  Last scan: 3 minutes ago (Broad Sweep)                             │
│  Next scan: Watchlist - LEGO 75192 in 4 minutes                     │
│  Today: 8 broad sweeps, 142 watchlist scans, 2 opportunities        │
└─────────────────────────────────────────────────────────────────────┘
```

**Paused state:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Vinted Scanner                                           [Resume]  │
├─────────────────────────────────────────────────────────────────────┤
│  Status: ⏸ Paused                                                   │
│  Reason: CAPTCHA detected at 14:32                                  │
│  Paused since: 2 hours ago                                          │
│                                                                      │
│  ⚠️ Please verify your Vinted account manually before resuming      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Opportunities Table

| Column | Description |
|--------|-------------|
| Set | Number + name, linked to Set Lookup |
| Vinted | Price + link to listing |
| Amazon | Price + link |
| COG% | Badge (green/yellow/red) |
| Profit | Estimated after fees |
| Your Data | Hover for popup (see 12.3) |
| Listed | "X hours ago" with visual aging |
| Actions | Dismiss, Mark Purchased |

**Row styling:**
- Green background: COG% ≤ threshold (viable)
- White/yellow: Near miss (threshold < COG% ≤ near-miss threshold)
- Visual aging: Listed time badge goes yellow → orange → red over 24h

#### Near Misses Table

Same columns as Opportunities, filtered to:
- COG% > threshold AND COG% ≤ near-miss threshold

#### Schedule View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Upcoming Scans                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  12:34  Broad Sweep                                                  │
│  12:38  LEGO 75192 Millennium Falcon                                │
│  12:44  LEGO 10300 DeLorean                                         │
│  12:51  LEGO 42141 McLaren F1                                       │
│  ...                                                                 │
│                                            [View Full Schedule]      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Scan History Table

| Column | Description |
|--------|-------------|
| Time | When scan ran |
| Type | Broad Sweep / Watchlist |
| Set | Set number (watchlist only) |
| Result | Listings found, opportunities |
| Delay | Actual timing delay used |
| Status | ✓ Success / ✗ Failed / ⚠️ CAPTCHA |

### 12.3 Your Data Popup (Hover)

When hovering over "Your Data" column:

```
┌─────────────────────────────────────────┐
│  LEGO 75192 - Your Sales & Stock        │
├─────────────────────────────────────────┤
│  Units sold (13 mo):     12             │
│  Average sell price:     £589.99        │
│  Last sale:              14 days ago    │
│  Current stock:          2 (Listed)     │
│                          1 (Backlog)    │
│  Days in stock (avg):    23             │
└─────────────────────────────────────────┘
```

**Data sources:**
- Sales: `platform_orders` + `platform_order_items` WHERE platform = 'amazon'
- Stock: `inventory_items` WHERE set_number matches

### 12.4 Settings Panel

```
┌─────────────────────────────────────────────────────────────────────┐
│  Scanner Settings                                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Scanner enabled           [✓]                                       │
│                                                                      │
│  COG% Thresholds                                                     │
│  ├─ Broad Sweep            [40] %                                   │
│  └─ Watchlist              [40] %                                   │
│                                                                      │
│  Near-miss threshold       [50] %                                   │
│                                                                      │
│  Operating Hours                                                     │
│  ├─ Start                  [08:00]                                  │
│  └─ End                    [22:00]                                  │
│                                                                      │
│                                              [Save Settings]         │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.5 Manual Controls

| Control | Action |
|---------|--------|
| **Scan Now** | Trigger immediate broad sweep |
| **Pause** | Pause all automated scanning |
| **Resume** | Resume automated scanning (with confirmation if paused due to CAPTCHA) |
| **Refresh Watchlist** | Recalculate 200-set watchlist |
| **Dismiss** (per opportunity) | Hide from list |
| **Mark Purchased** (per opportunity) | Record as acted upon |

---

## 13. Profit Calculation

### 13.1 Formula

Use existing Amazon FBM profit calculation from arbitrage feature:

```
Net Payout = Sale Price - Referral Fee - DST - VAT on Fees - Shipping
Profit = Net Payout - COG (Vinted Price)
ROI = Profit / COG × 100
COG% = COG / Sale Price × 100
```

### 13.2 Fee Assumptions

| Fee | Rate |
|-----|------|
| Referral Fee | 15% |
| Digital Services Tax | 2% |
| VAT on Fees | 20% |
| Effective combined | 18.36% |
| Shipping (FBM) | £4.00 default |

---

## 14. Opportunity Lifecycle

```
Found → Active → Purchased / Dismissed / Expired
                         │
                         └── (auto after 7 days)
```

### 14.1 States

| State | Description |
|-------|-------------|
| active | Visible in opportunities table |
| purchased | User marked as bought |
| dismissed | User manually dismissed |
| expired | Auto-expired after 7 days |

### 14.2 Visual Aging

Listed time badge colour progression:

| Age | Colour |
|-----|--------|
| < 4 hours | Green |
| 4–12 hours | Yellow |
| 12–24 hours | Orange |
| > 24 hours | Red |

### 14.3 Cleanup

- Opportunities with `status = 'expired'` deleted after 7 days
- Opportunities with `status IN ('purchased', 'dismissed')` kept for 30 days for reporting

---

## 15. Deprecation of Existing Components

### 15.1 Current Vinted Arbitrage Feature

The existing manual Vinted arbitrage feature consists of:

| Component | Path | Purpose |
|-----------|------|---------|
| Page | `/apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx` | Manual URL input and scan |
| API Route | `/apps/web/src/app/api/arbitrage/vinted/route.ts` | Fetches Vinted page, extracts listings |
| Documentation | `/docs/features/arbitrage/vinted-arbitrage.md` | User journey documentation |

### 15.2 Deprecation Decision

| Component | Action | Rationale |
|-----------|--------|-----------|
| Manual scan page | **REMOVE** | Replaced by automated scanning with better UI |
| Manual scan API | **REMOVE** | No longer needed; automation uses Claude + Chrome |
| Set number extraction logic | **KEEP/MIGRATE** | Reuse in automation result processing |
| ASIN matching logic | **KEEP/MIGRATE** | Reuse in automation result processing |
| COG% calculation | **KEEP/MIGRATE** | Reuse in automation |
| Documentation | **REPLACE** | New docs for automated feature |

### 15.3 Components to Remove

**Files to delete:**

```
apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx
apps/web/src/app/api/arbitrage/vinted/route.ts
docs/features/arbitrage/vinted-arbitrage.md
```

**Navigation updates:**
- Remove "Vinted" link from arbitrage navigation (or redirect to new automation page)
- Update any cross-references in other documentation

### 15.4 Logic to Migrate

The following logic from the existing implementation should be extracted and reused:

**Set Number Extraction:**
```typescript
// Current location: vinted/route.ts or page.tsx
// Patterns for extracting LEGO set numbers from listing titles
// Move to: shared utility or automation service
```

**ASIN Matching:**
```typescript
// Lookup set number → ASIN via seeded_asins table
// Already exists as shared logic, ensure automation uses same path
```

**COG% / Profit Calculation:**
```typescript
// Amazon fee calculation (18.36% effective rate)
// Already shared with Amazon arbitrage, ensure consistency
```

### 15.5 Migration Steps

**Phase 1 (Before automation launch):**
1. Extract reusable logic into shared utilities
2. Ensure new automation uses extracted utilities
3. Verify calculation parity between old and new

**Phase 2 (At automation launch):**
1. Deploy new automation feature at `/arbitrage/vinted/automation`
2. Add redirect from `/arbitrage/vinted` → `/arbitrage/vinted/automation`
3. Update navigation menu

**Phase 3 (Cleanup - 2 weeks after launch):**
1. Remove old page component
2. Remove old API route
3. Remove redirect (make automation the canonical URL)
4. Archive old documentation

### 15.6 Rollback Plan

If automation fails and manual scanning is needed:
- Keep old files in version control (don't delete from git history)
- Can restore from git if emergency rollback required
- Consider: Keep manual scan as hidden "emergency" route during initial automation period

---

## 16. Implementation Phases

### Phase 0: Deprecation Prep

1. Extract reusable logic from existing Vinted arbitrage
2. Create shared utilities for set number extraction
3. Verify ASIN matching and COG% calculation consistency

### Phase 1: Infrastructure

1. Create database tables
2. Add `seeded_asin_rankings` collection job
3. Bootstrap sales rank data (3 days)
4. Implement watchlist materialisation

### Phase 2: Scanner Core (WITH SAFETY TESTING)

1. Claude Code scan script for broad sweep
2. Claude Code scan script for watchlist
3. **CAPTCHA detection logic**
4. Cron scheduling with randomisation
5. Result parsing and storage
6. **Safety testing protocol (see Section 3.8)**

### Phase 3: Alerts

1. Add `sendVintedOpportunity()` to Pushover service
2. Add `sendVintedCaptchaWarning()` to Pushover service
3. Implement daily summary notification
4. Add consecutive failure alerting

### Phase 4: UI

1. Scanner status card (including pause state)
2. Opportunities table with hover popup
3. Near misses table
4. Schedule view
5. Scan history table
6. Settings panel
7. Manual controls (pause/resume/scan now)
8. Watchlist health view

### Phase 5: Polish

1. Error handling refinement
2. Health monitoring dashboard
3. Performance optimisation
4. Documentation

### Phase 6: Deprecation Cleanup

1. Add redirect from old `/arbitrage/vinted` to new automation page
2. Monitor for 2 weeks to ensure no issues
3. Remove old page component and API route
4. Update navigation to point directly to automation
5. Archive old documentation

---

## 17. Open Questions

None remaining. Requirements complete.

---

## 18. Related Documentation

- [Vinted Arbitrage (Manual)](./vinted-arbitrage.md) - Existing manual scan feature
- [Amazon Arbitrage](./amazon-arbitrage.md) - Profit calculation reference
- [Seeded ASINs](./seeded-asins.md) - ASIN discovery system
- [Amazon Integration](./amazon.md) - SP-API for sales rank

---

## 19. Appendix A: Example Cron Script

```bash
#!/bin/bash
# /home/user/vinted-scanner/scan.sh

# Random delay (0-30 minutes)
sleep $((RANDOM % 1800))

# Check if within operating hours
HOUR=$(date +%H)
if [ "$HOUR" -lt 8 ] || [ "$HOUR" -ge 22 ]; then
  exit 0
fi

# Run Claude Code with Chrome
claude --chrome -p "vinted-broad-sweep" \
  --dangerously-skip-permissions \
  --output-format json \
  > /tmp/vinted-scan-result.json 2>&1

# Process results (call API endpoint)
curl -X POST https://app.hadleybricks.com/api/arbitrage/vinted/process \
  -H "Authorization: Bearer $API_TOKEN" \
  -d @/tmp/vinted-scan-result.json
```

---

## 20. Appendix B: CAPTCHA Detection

The scanner must detect CAPTCHA challenges and halt immediately.

### Detection Methods

```typescript
// Check for DataDome CAPTCHA indicators
function detectCaptcha(page: Page): boolean {
  // Method 1: URL check
  if (page.url().includes('captcha') || page.url().includes('geo.captcha-delivery.com')) {
    return true;
  }
  
  // Method 2: DOM element check
  const captchaFrame = document.querySelector('iframe[src*="captcha"]');
  if (captchaFrame) return true;
  
  // Method 3: DataDome specific
  const datadomeBlock = document.querySelector('[class*="datadome"]');
  if (datadomeBlock) return true;
  
  // Method 4: Page title check
  if (document.title.toLowerCase().includes('blocked') || 
      document.title.toLowerCase().includes('captcha')) {
    return true;
  }
  
  return false;
}
```

### Response Protocol

```typescript
if (detectCaptcha(page)) {
  // 1. Log the incident
  await logScanResult({
    status: 'captcha',
    error_message: 'CAPTCHA detected - scanning paused'
  });
  
  // 2. Update config to paused state
  await pauseScanner({
    reason: 'CAPTCHA detected',
    paused_at: new Date()
  });
  
  // 3. Send high-priority alert
  await pushoverService.sendVintedCaptchaWarning();
  
  // 4. Exit without processing
  return;
}
```

---

## 21. Appendix C: Risk Checklist for Implementation

**Before each implementation milestone, verify:**

- [ ] All timing values include randomisation (no fixed intervals)
- [ ] CAPTCHA detection is implemented and tested
- [ ] Pause functionality works correctly
- [ ] Scan logs capture timing data for pattern analysis
- [ ] User can see exactly what the scanner is doing
- [ ] Kill switch (pause) is easily accessible
- [ ] Conservative defaults are in place
- [ ] No hardcoded timing values that could create patterns

**Before going live:**

- [ ] Manual baseline behaviour documented
- [ ] Single automated scan tested without CAPTCHA
- [ ] 1-week low-frequency test completed
- [ ] No CAPTCHA appearances during testing
- [ ] User understands and accepts remaining risk
- [ ] Rollback plan documented

---

*Document version: 1.2*
*Last updated: 2026-01-21*
*Changes: Added deprecation section for existing Vinted arbitrage components*
