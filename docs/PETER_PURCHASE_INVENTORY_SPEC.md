# Peter Purchase-Inventory Service Endpoint Spec

## Overview

Enable Peterbot (running in tmux via Claude Code) to execute the full purchase-inventory workflow without requiring Playwright browser automation. Uses service-level API endpoints authenticated via API key.

## Current vs Proposed Architecture

```
CURRENT (Browser-based):
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Claude Code    │───▶│  Playwright      │───▶│  Next.js API    │
│  (local)        │    │  browser_evaluate│    │  (user session) │
└─────────────────┘    └──────────────────┘    └─────────────────┘

PROPOSED (Service-based):
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Peter (tmux)   │───▶│  curl / fetch    │───▶│  Service API    │
│  Claude Code    │    │  + API key       │    │  (/api/service) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 1. Authentication Layer

### API Key Strategy

| Component | Description |
|-----------|-------------|
| Key format | `hb_sk_` prefix + 32-char random string |
| Storage | `service_api_keys` table in Supabase |
| Header | `x-api-key: hb_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| Scope | Per-key permissions (read, write, admin) |

### Database Schema

```sql
-- Migration: create_service_api_keys
CREATE TABLE service_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- "peter-bot", "automation-1"
  key_hash TEXT NOT NULL UNIQUE,         -- SHA-256 hash of key
  key_prefix TEXT NOT NULL,              -- First 8 chars for identification
  permissions JSONB DEFAULT '["read"]',  -- ["read", "write", "admin"]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                -- NULL = never expires
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id)
);

-- Index for fast lookup
CREATE INDEX idx_service_api_keys_hash ON service_api_keys(key_hash);
CREATE INDEX idx_service_api_keys_prefix ON service_api_keys(key_prefix);
```

### Key Generation Endpoint

```
POST /api/admin/service-keys
Body: { "name": "peter-bot", "permissions": ["read", "write"] }
Response: { "key": "hb_sk_...", "id": "uuid", "prefix": "hb_sk_ab" }
```

Note: Full key only returned once at creation. Store securely.

### Auth Middleware

```typescript
// apps/web/src/lib/middleware/service-auth.ts

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function validateServiceKey(
  request: Request,
  requiredPermissions: string[] = ['read']
): Promise<{ valid: boolean; keyId?: string; error?: string }> {
  const apiKey = request.headers.get('x-api-key');

  if (!apiKey) {
    return { valid: false, error: 'Missing x-api-key header' };
  }

  if (!apiKey.startsWith('hb_sk_')) {
    return { valid: false, error: 'Invalid key format' };
  }

  const keyHash = createHash('sha256').update(apiKey).digest('hex');

  const { data, error } = await supabase
    .from('service_api_keys')
    .select('id, permissions, expires_at, revoked_at')
    .eq('key_hash', keyHash)
    .single();

  if (error || !data) {
    return { valid: false, error: 'Invalid API key' };
  }

  if (data.revoked_at) {
    return { valid: false, error: 'API key revoked' };
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false, error: 'API key expired' };
  }

  const permissions = data.permissions as string[];
  const hasPermission = requiredPermissions.every(p => permissions.includes(p));

  if (!hasPermission) {
    return { valid: false, error: `Missing required permissions: ${requiredPermissions.join(', ')}` };
  }

  // Update last_used_at (fire and forget)
  supabase
    .from('service_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return { valid: true, keyId: data.id };
}
```

---

## 2. Service Endpoints

All service endpoints live under `/api/service/` prefix and require `x-api-key` header.

### 2.1 Brickset Lookup

```
GET /api/service/brickset/lookup?setNumber={setNumber}&forceRefresh=false
```

**Implementation:** Wraps existing `/api/brickset/lookup` logic but uses service auth.

```typescript
// apps/web/src/app/api/service/brickset/lookup/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceKey } from '@/lib/middleware/service-auth';
import { BricksetCacheService } from '@/lib/brickset/brickset-cache.service';

export async function GET(request: NextRequest) {
  // Validate API key
  const auth = await validateServiceKey(request, ['read']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const setNumber = request.nextUrl.searchParams.get('setNumber');
  const forceRefresh = request.nextUrl.searchParams.get('forceRefresh') === 'true';

  if (!setNumber) {
    return NextResponse.json({ error: 'setNumber required' }, { status: 400 });
  }

  try {
    // Use system Brickset API key for service calls
    const cacheService = new BricksetCacheService();
    const result = await cacheService.getOrFetchSet(
      setNumber,
      process.env.BRICKSET_API_KEY!,
      forceRefresh
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
```

**Response:**
```json
{
  "data": {
    "setNumber": "75192-1",
    "name": "Millennium Falcon",
    "theme": "Star Wars",
    "subtheme": "Ultimate Collector Series",
    "year": 2017,
    "pieces": 7541,
    "minifigs": 8,
    "rrp_uk": 649.99,
    "image_url": "https://..."
  }
}
```

### 2.2 ASIN Lookup

```
GET /api/service/inventory/lookup-asin?setNumber={setNumber}&ean={ean}
```

**Implementation:** Wraps existing `/api/inventory/lookup-asin` logic.

```typescript
// apps/web/src/app/api/service/inventory/lookup-asin/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceKey } from '@/lib/middleware/service-auth';
import { AmazonCatalogClient } from '@/lib/amazon/amazon-catalog.client';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = await validateServiceKey(request, ['read']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const setNumber = request.nextUrl.searchParams.get('setNumber');
  const ean = request.nextUrl.searchParams.get('ean');

  if (!setNumber && !ean) {
    return NextResponse.json({ error: 'setNumber or ean required' }, { status: 400 });
  }

  try {
    // 1. Check existing inventory first
    if (setNumber) {
      const existing = await prisma.inventory_items.findFirst({
        where: {
          set_number: { contains: setNumber.replace(/-\d+$/, '') },
          amazon_asin: { not: null }
        },
        select: { amazon_asin: true, name: true }
      });

      if (existing?.amazon_asin) {
        return NextResponse.json({
          data: {
            asin: existing.amazon_asin,
            source: 'inventory',
            title: existing.name
          }
        });
      }
    }

    // 2. Call Amazon API using system credentials
    const amazonClient = await AmazonCatalogClient.fromSystemCredentials();

    if (ean) {
      const result = await amazonClient.searchCatalogByIdentifier(ean, 'EAN');
      if (result) {
        return NextResponse.json({
          data: { asin: result.asin, source: 'amazon_ean', title: result.title }
        });
      }
    }

    if (setNumber) {
      const baseSetNumber = setNumber.replace(/-\d+$/, '');
      const result = await amazonClient.searchCatalogByKeywords(`LEGO ${baseSetNumber}`);
      if (result) {
        return NextResponse.json({
          data: { asin: result.asin, source: 'amazon_search', title: result.title }
        });
      }
    }

    return NextResponse.json({ data: null, message: 'No ASIN found' });
  } catch (error) {
    return NextResponse.json({ error: 'ASIN lookup failed' }, { status: 500 });
  }
}
```

### 2.3 Amazon Pricing (Batch)

```
GET /api/service/amazon/competitive-summary?asins=ASIN1,ASIN2,...
```

**Implementation:** Wraps existing pricing endpoint.

```typescript
// apps/web/src/app/api/service/amazon/competitive-summary/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceKey } from '@/lib/middleware/service-auth';
import { AmazonPricingClient } from '@/lib/amazon/amazon-pricing.client';

export async function GET(request: NextRequest) {
  const auth = await validateServiceKey(request, ['read']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const asinsParam = request.nextUrl.searchParams.get('asins');
  if (!asinsParam) {
    return NextResponse.json({ error: 'asins parameter required' }, { status: 400 });
  }

  const asins = asinsParam.split(',').slice(0, 20); // Max 20

  try {
    const pricingClient = await AmazonPricingClient.fromSystemCredentials();
    const results = await pricingClient.getCompetitiveSummaryBatch(asins);

    return NextResponse.json({ data: results });
  } catch (error) {
    return NextResponse.json({ error: 'Pricing lookup failed' }, { status: 500 });
  }
}
```

**Response:**
```json
{
  "data": {
    "B075SDMMMV": {
      "asin": "B075SDMMMV",
      "buyBoxPrice": 549.99,
      "lowestNewPrice": 529.00,
      "wasPrice": 649.99,
      "currency": "GBP"
    }
  }
}
```

### 2.4 Create Purchase

```
POST /api/service/purchases
```

```typescript
// apps/web/src/app/api/service/purchases/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceKey } from '@/lib/middleware/service-auth';
import { prisma } from '@/lib/prisma';

interface CreatePurchaseRequest {
  source: string;           // "Vinted", "eBay", "Amazon", etc.
  cost: number;             // Total cost in GBP
  payment_method: string;   // "Monzo Card", "PayPal", etc.
  purchase_date: string;    // ISO date
  notes?: string;
  order_reference?: string;
  seller_username?: string;
  mileage?: number;
}

export async function POST(request: NextRequest) {
  const auth = await validateServiceKey(request, ['write']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  try {
    const body: CreatePurchaseRequest = await request.json();

    // Validate required fields
    if (!body.source || body.cost === undefined || !body.payment_method || !body.purchase_date) {
      return NextResponse.json({
        error: 'Missing required fields: source, cost, payment_method, purchase_date'
      }, { status: 400 });
    }

    const purchase = await prisma.purchases.create({
      data: {
        source: body.source,
        cost: body.cost,
        payment_method: body.payment_method,
        purchase_date: new Date(body.purchase_date),
        notes: body.notes,
        order_reference: body.order_reference,
        seller_username: body.seller_username,
        mileage: body.mileage,
        // Default user_id to system user for service calls
        user_id: process.env.SYSTEM_USER_ID
      }
    });

    return NextResponse.json({ data: purchase }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create purchase' }, { status: 500 });
  }
}
```

### 2.5 Create Inventory Items (Bulk)

```
POST /api/service/inventory
```

```typescript
// apps/web/src/app/api/service/inventory/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceKey } from '@/lib/middleware/service-auth';
import { prisma } from '@/lib/prisma';

interface CreateInventoryRequest {
  items: Array<{
    set_number: string;
    name: string;
    condition: 'New' | 'Used';
    cost: number;
    purchase_id: string;
    listing_platform?: string;
    storage_location?: string;
    amazon_asin?: string;
    notes?: string;
  }>;
}

export async function POST(request: NextRequest) {
  const auth = await validateServiceKey(request, ['write']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  try {
    const body: CreateInventoryRequest = await request.json();

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'items array required' }, { status: 400 });
    }

    // Validate all items have required fields
    for (const item of body.items) {
      if (!item.set_number || !item.name || !item.condition || item.cost === undefined || !item.purchase_id) {
        return NextResponse.json({
          error: 'Each item requires: set_number, name, condition, cost, purchase_id'
        }, { status: 400 });
      }
    }

    // Create all items in a transaction
    const createdItems = await prisma.$transaction(
      body.items.map(item =>
        prisma.inventory_items.create({
          data: {
            set_number: item.set_number,
            name: item.name,
            condition: item.condition,
            cost: item.cost,
            purchase_id: item.purchase_id,
            listing_platform: item.listing_platform,
            storage_location: item.storage_location,
            amazon_asin: item.amazon_asin,
            notes: item.notes,
            status: 'In Stock',
            user_id: process.env.SYSTEM_USER_ID
          }
        })
      )
    );

    return NextResponse.json({ data: createdItems }, { status: 201 });
  } catch (error) {
    // If creation fails, the transaction auto-rolls back
    return NextResponse.json({ error: 'Failed to create inventory items' }, { status: 500 });
  }
}
```

### 2.6 Upload Photos

```
POST /api/service/purchases/{purchaseId}/photos
Content-Type: multipart/form-data
```

```typescript
// apps/web/src/app/api/service/purchases/[purchaseId]/photos/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceKey } from '@/lib/middleware/service-auth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ purchaseId: string }> }
) {
  const auth = await validateServiceKey(request, ['write']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { purchaseId } = await params;

  try {
    const formData = await request.formData();
    const files = formData.getAll('photos') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'No photos provided' }, { status: 400 });
    }

    const uploadedUrls: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = `${purchaseId}/${Date.now()}-${file.name}`;

      const { data, error } = await supabase.storage
        .from('purchase-photos')
        .upload(filename, buffer, {
          contentType: file.type,
          upsert: false
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('purchase-photos')
        .getPublicUrl(data.path);

      uploadedUrls.push(urlData.publicUrl);
    }

    // Link photos to purchase record
    await supabase
      .from('purchase_photos')
      .insert(uploadedUrls.map(url => ({
        purchase_id: purchaseId,
        url,
        uploaded_at: new Date().toISOString()
      })));

    return NextResponse.json({ data: { urls: uploadedUrls } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Photo upload failed' }, { status: 500 });
  }
}
```

---

## 3. Peter Skill Definition

### Skill File

```markdown
<!-- domains/peterbot/wsl_config/skills/hb-add-purchase/skill.md -->

# hb-add-purchase

Add a new purchase with inventory items to Hadley Bricks.

## Trigger Patterns
- "add purchase", "new purchase", "bought some lego"
- "add inventory", "log purchase"
- Photo of receipt or LEGO boxes

## Required Environment
- HB_SERVICE_API_KEY: Service API key for Hadley Bricks
- HB_API_BASE_URL: Base URL (default: https://hadley-bricks.vercel.app)

## Workflow

### Phase 1: Input Analysis
Analyze provided photos and/or text to extract:
- Set numbers (from boxes, receipts)
- Cost/price
- Source/platform (Vinted, eBay, Amazon, etc.)
- Order reference
- Seller username

### Phase 2: Interview (collect missing required fields)
Ask ONE question at a time for any missing:
1. Set numbers (comma-separated, e.g., "75192, 10294")
2. Total cost (GBP)
3. Source/platform
4. Payment method (default by source: Vinted→Monzo Card, eBay→PayPal)
5. Purchase date (default: today)
6. Condition (New/Used)
7. Listing platform (Amazon UK, eBay UK, etc.)
8. Storage location

### Phase 3: Data Enrichment
For each set number, call service endpoints:

```bash
# Brickset lookup
curl -s -H "x-api-key: $HB_SERVICE_API_KEY" \
  "$HB_API_BASE_URL/api/service/brickset/lookup?setNumber=75192"

# ASIN lookup
curl -s -H "x-api-key: $HB_SERVICE_API_KEY" \
  "$HB_API_BASE_URL/api/service/inventory/lookup-asin?setNumber=75192"
```

### Phase 4: Cost Allocation (if multiple items)
Options:
- **Equal split**: Total ÷ number of items
- **Custom**: User specifies per-item costs
- **Proportional**: By Amazon listing value

For proportional, fetch prices:
```bash
curl -s -H "x-api-key: $HB_SERVICE_API_KEY" \
  "$HB_API_BASE_URL/api/service/amazon/competitive-summary?asins=B075SDMMMV,B09BG3N63L"
```

### Phase 5: Review
Show complete summary table:
| Field | Value |
|-------|-------|
| Set | 75192-1 Millennium Falcon |
| Cost | £45.00 |
| Source | Vinted |
| ... | ... |

Ask: "Create this purchase? (yes/no/edit)"

### Phase 6: Create Records
```bash
# 1. Create purchase
PURCHASE_RESPONSE=$(curl -s -X POST \
  -H "x-api-key: $HB_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"Vinted","cost":45.00,"payment_method":"Monzo Card","purchase_date":"2026-02-03"}' \
  "$HB_API_BASE_URL/api/service/purchases")

PURCHASE_ID=$(echo $PURCHASE_RESPONSE | jq -r '.data.id')

# 2. Create inventory items
curl -s -X POST \
  -H "x-api-key: $HB_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"set_number":"75192-1","name":"Millennium Falcon","condition":"Used","cost":45.00,"purchase_id":"'$PURCHASE_ID'","listing_platform":"Amazon UK"}]}' \
  "$HB_API_BASE_URL/api/service/inventory"
```

### Phase 7: Photo Upload (if photos provided)
```bash
curl -s -X POST \
  -H "x-api-key: $HB_SERVICE_API_KEY" \
  -F "photos=@/path/to/photo.jpg" \
  "$HB_API_BASE_URL/api/service/purchases/$PURCHASE_ID/photos"
```

### Rollback on Failure
If inventory creation fails after purchase created:
```bash
curl -s -X DELETE \
  -H "x-api-key: $HB_SERVICE_API_KEY" \
  "$HB_API_BASE_URL/api/service/purchases/$PURCHASE_ID"
```

## Example Interaction

**User:** Add purchase - bought 75192 and 10294 on Vinted for £85

**Peter:** Got it! Let me look those up...

✓ 75192-1: Millennium Falcon (Star Wars UCS, 2017)
✓ 10294-1: Titanic (Icons, 2021)

A few quick questions:

**Condition?** (New/Used)
```

### Environment Setup

Add to Peter's shell environment (in `.bashrc` or startup script):

```bash
export HB_SERVICE_API_KEY="hb_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export HB_API_BASE_URL="https://hadley-bricks.vercel.app"
```

---

## 4. Implementation Roadmap

### Phase 1: Database & Auth (1-2 hours)
- [ ] Create `service_api_keys` migration
- [ ] Implement `validateServiceKey` middleware
- [ ] Create admin endpoint for key generation
- [ ] Generate Peter's API key

### Phase 2: Service Endpoints (2-3 hours)
- [ ] `/api/service/brickset/lookup`
- [ ] `/api/service/inventory/lookup-asin`
- [ ] `/api/service/amazon/competitive-summary`
- [ ] `/api/service/purchases` (POST, DELETE)
- [ ] `/api/service/inventory` (POST)
- [ ] `/api/service/purchases/[id]/photos` (POST)

### Phase 3: Testing (1 hour)
- [ ] Test each endpoint with curl
- [ ] Test error cases (invalid key, missing fields)
- [ ] Test rollback scenario

### Phase 4: Peter Skill (1 hour)
- [ ] Create skill.md in wsl_config/skills/
- [ ] Add environment variables to Peter's shell
- [ ] Test end-to-end via Discord

---

## 5. Security Considerations

| Risk | Mitigation |
|------|------------|
| Key exposure | Keys are hashed in DB, only shown once at creation |
| Rate limiting | Add rate limit middleware (100 req/min per key) |
| Scope creep | Permissions system limits what each key can do |
| Key rotation | Support key regeneration without downtime |
| Audit trail | Log all service API calls with key ID |

---

## 6. API Reference Summary

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/api/service/brickset/lookup` | GET | read | Look up set by number |
| `/api/service/inventory/lookup-asin` | GET | read | Find ASIN for set |
| `/api/service/amazon/competitive-summary` | GET | read | Batch pricing lookup |
| `/api/service/purchases` | POST | write | Create purchase |
| `/api/service/purchases/{id}` | DELETE | write | Delete purchase (rollback) |
| `/api/service/inventory` | POST | write | Create inventory items |
| `/api/service/purchases/{id}/photos` | POST | write | Upload photos |
| `/api/admin/service-keys` | POST | admin | Generate new API key |

---

## 7. Alternative: MCP Server Approach

Instead of HTTP endpoints, could build an MCP server that Peter's Claude Code connects to:

```json
// ~/.claude/config.json (Peter's WSL)
{
  "mcpServers": {
    "hadley-bricks": {
      "command": "npx",
      "args": ["hadley-bricks-mcp"],
      "env": {
        "HB_SERVICE_KEY": "hb_sk_xxx"
      }
    }
  }
}
```

**Pros:**
- Native Claude Code integration (no curl)
- Better error handling
- Structured tool definitions

**Cons:**
- More complex to build
- Requires npm package or local server
- HTTP endpoints more versatile (can be used by other services)

**Recommendation:** Start with HTTP service endpoints. Can add MCP server later as enhancement.

---

## 8. Email-Driven Proactive Purchase Import

### Overview

Peter periodically scans emails for Vinted and eBay purchase confirmations and proactively suggests creating inventory records. This is an **automated discovery** pattern, separate from user-initiated purchase logging.

### Workflow Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Scheduled Job  │───▶│  Hadley API      │───▶│  Parse Email    │
│  (every 2 hrs)  │    │  /gmail/search   │    │  Extract Data   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                        │
                       ┌────────────────────────────────┘
                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Enrich Data    │───▶│  Auto-Defaults   │───▶│  Confirm with   │
│  Brickset/ASIN  │    │  (see below)     │    │  Chris          │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                        │
                       ┌────────────────────────────────┘
                       ▼
┌─────────────────┐    ┌──────────────────┐
│  Create Records │───▶│  Report to       │
│  via Service API│    │  #peterbot       │
└─────────────────┘    └──────────────────┘
```

### Auto-Defaults for Email Import Mode

| Field | Default Value | Notes |
|-------|---------------|-------|
| Listing platform | **Amazon UK** | All email-imported items target Amazon |
| Purchase mapping | **1:1** | One purchase record per item (not bundled) |
| List price | **Buy box - round down to .49/.99** | e.g., £38.72 → £37.99, £45.20 → £44.49 |
| Condition | **New** (Vinted), **New** if sealed (eBay) | Vinted always New; eBay inferred from keywords |
| Payment method | **Monzo Card** (Vinted), **PayPal** (eBay) | Platform defaults |
| Storage location | Prompt user or use last-used | Not auto-defaulted |

### List Price Rounding Logic

```typescript
function calculateListPrice(buyBoxPrice: number): number {
  // Round down to nearest .49 or .99
  const wholePart = Math.floor(buyBoxPrice);
  const decimalPart = buyBoxPrice - wholePart;

  if (decimalPart >= 0.50) {
    // Round down to .49
    return wholePart + 0.49;
  } else {
    // Round down to previous .99
    return wholePart - 0.01;  // e.g., 38.20 → 37.99
  }
}

// Examples:
// £38.72 → £38.49
// £45.20 → £44.99 (not 45.49 - we round DOWN)
// £50.00 → £49.99
// £29.51 → £29.49
```

### Email Search Patterns

#### Vinted Purchase Confirmations

**Search query:** `from:noreply@vinted.co.uk subject:"You bought" newer_than:7d`

**Email pattern to parse:**
```
Subject: You bought [Item Name]
From: noreply@vinted.co.uk

Hi Chris,
You bought [Item Name] from [seller_username] for £[price].
Order number: [order_reference]
```

**Extraction regex:**
```typescript
const vintedPatterns = {
  subject: /You bought (.+)/,
  price: /for £([\d.]+)/,
  seller: /from ([^\s]+) for/,
  orderRef: /Order number: (\d+)/,
  // Set number extraction from item name
  setNumber: /\b(\d{4,5}(?:-\d)?)\b/  // e.g., "75192" or "75192-1"
};
```

#### eBay Purchase Confirmations

**Search query:** `from:ebay@ebay.co.uk subject:"Order confirmed" newer_than:7d`

**Email pattern to parse:**
```
Subject: Order confirmed: [Item Name]
From: ebay@ebay.co.uk

Your order is confirmed
[Item Name]
Item price: £[price]
Order number: [order_reference]
Seller: [seller_username]
```

**Extraction regex:**
```typescript
const ebayPatterns = {
  subject: /Order confirmed: (.+)/,
  price: /Item price: £([\d.]+)/,
  orderRef: /Order number: (\d+-\d+)/,
  seller: /Seller: ([^\n]+)/,
  setNumber: /\b(\d{4,5}(?:-\d)?)\b/
};
```

### Service Endpoint: Parse Purchase Emails

```
GET /api/service/purchases/scan-emails
```

This endpoint:
1. Searches Gmail via Hadley API
2. Parses matching emails
3. Checks if order_reference already exists (avoid duplicates)
4. Returns structured purchase candidates

```typescript
// apps/web/src/app/api/service/purchases/scan-emails/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceKey } from '@/lib/middleware/service-auth';
import { prisma } from '@/lib/prisma';

interface PurchaseCandidate {
  source: 'Vinted' | 'eBay';
  order_reference: string;
  seller_username: string;
  item_name: string;
  set_number: string | null;  // Extracted if found
  cost: number;
  purchase_date: string;
  email_id: string;           // For fetching full email if needed
  payment_method: string;     // Auto-defaulted
  suggested_condition: 'New' | 'Used';
  already_imported: boolean;  // True if order_reference exists
}

export async function GET(request: NextRequest) {
  const auth = await validateServiceKey(request, ['read']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const days = parseInt(request.nextUrl.searchParams.get('days') || '7');

  try {
    const candidates: PurchaseCandidate[] = [];

    // 1. Search Vinted emails
    const vintedEmails = await fetchEmails(
      `from:noreply@vinted.co.uk subject:"You bought" newer_than:${days}d`
    );

    for (const email of vintedEmails) {
      const parsed = parseVintedEmail(email);
      if (parsed) {
        // Check if already imported
        const existing = await prisma.purchases.findFirst({
          where: { order_reference: parsed.order_reference }
        });

        candidates.push({
          ...parsed,
          source: 'Vinted',
          payment_method: 'Monzo Card',
          suggested_condition: 'New',  // Vinted purchases are always New condition
          already_imported: !!existing
        });
      }
    }

    // 2. Search eBay emails
    const ebayEmails = await fetchEmails(
      `from:ebay@ebay.co.uk subject:"Order confirmed" newer_than:${days}d`
    );

    for (const email of ebayEmails) {
      const parsed = parseEbayEmail(email);
      if (parsed) {
        const existing = await prisma.purchases.findFirst({
          where: { order_reference: parsed.order_reference }
        });

        // Infer condition from item name
        const isSealed = /sealed|bnib|new|unopened/i.test(parsed.item_name);

        candidates.push({
          ...parsed,
          source: 'eBay',
          payment_method: 'PayPal',
          suggested_condition: isSealed ? 'New' : 'Used',
          already_imported: !!existing
        });
      }
    }

    // Filter out already imported
    const newCandidates = candidates.filter(c => !c.already_imported);

    return NextResponse.json({
      data: {
        candidates: newCandidates,
        already_imported: candidates.filter(c => c.already_imported).length,
        total_found: candidates.length
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Email scan failed' }, { status: 500 });
  }
}

async function fetchEmails(query: string): Promise<any[]> {
  // Call Hadley API
  const response = await fetch(
    `http://172.19.64.1:8100/gmail/search?q=${encodeURIComponent(query)}`
  );
  return response.json();
}

function parseVintedEmail(email: any): Partial<PurchaseCandidate> | null {
  // Implementation of regex parsing
  // Returns null if can't parse
}

function parseEbayEmail(email: any): Partial<PurchaseCandidate> | null {
  // Implementation of regex parsing
}
```

### Service Endpoint: Batch Create from Email Scan

```
POST /api/service/purchases/batch-import
```

Creates multiple 1:1 purchase+inventory records with auto-defaults.

```typescript
// apps/web/src/app/api/service/purchases/batch-import/route.ts

interface BatchImportRequest {
  items: Array<{
    source: 'Vinted' | 'eBay';
    order_reference: string;
    seller_username: string;
    set_number: string;
    set_name: string;          // From Brickset lookup
    cost: number;
    purchase_date: string;
    condition: 'New' | 'Used';
    payment_method: string;
    amazon_asin?: string;      // From ASIN lookup
    list_price: number;        // Calculated from buy box
    storage_location?: string;
  }>;
}

interface BatchImportResponse {
  data: {
    created: Array<{
      purchase_id: string;
      inventory_id: string;
      set_number: string;
      set_name: string;
    }>;
    failed: Array<{
      set_number: string;
      error: string;
    }>;
  };
}

export async function POST(request: NextRequest) {
  const auth = await validateServiceKey(request, ['write']);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const body: BatchImportRequest = await request.json();

  const created: any[] = [];
  const failed: any[] = [];

  for (const item of body.items) {
    try {
      // Create purchase (1:1 mapping)
      const purchase = await prisma.purchases.create({
        data: {
          source: item.source,
          cost: item.cost,
          payment_method: item.payment_method,
          purchase_date: new Date(item.purchase_date),
          order_reference: item.order_reference,
          seller_username: item.seller_username,
          user_id: process.env.SYSTEM_USER_ID
        }
      });

      // Create inventory item
      const inventory = await prisma.inventory_items.create({
        data: {
          set_number: item.set_number,
          name: item.set_name,
          condition: item.condition,
          cost: item.cost,
          purchase_id: purchase.id,
          listing_platform: 'Amazon UK',  // Email import default
          storage_location: item.storage_location,
          amazon_asin: item.amazon_asin,
          list_price: item.list_price,
          status: 'In Stock',
          user_id: process.env.SYSTEM_USER_ID
        }
      });

      created.push({
        purchase_id: purchase.id,
        inventory_id: inventory.id,
        set_number: item.set_number,
        set_name: item.set_name
      });
    } catch (error) {
      failed.push({
        set_number: item.set_number,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return NextResponse.json({ data: { created, failed } }, { status: 201 });
}
```

### Peter Skill: Email Purchase Scanner

```markdown
<!-- domains/peterbot/wsl_config/skills/hb-email-purchases/SKILL.md -->

---
name: hb-email-purchases
description: Scan emails for Vinted/eBay purchases and auto-import to inventory
trigger:
  - "scan purchase emails"
  - "check for new purchases"
  - "import purchases from email"
scheduled: true
conversational: true
channel: ai-briefings
---

# Email Purchase Scanner

## Purpose

Automatically scans Gmail for Vinted and eBay purchase confirmation emails,
extracts set numbers and purchase details, and creates inventory records
with intelligent defaults. Runs overnight and posts a morning report.

## Execution Modes

### Mode 1: Scheduled (Automated - 2am daily)

- Runs during quiet hours
- No confirmation needed - creates records automatically
- Posts summary report to #ai-briefings
- User reviews report in the morning

### Mode 2: Manual (Conversational)

Triggered by: "scan purchase emails", "check for new purchases"
- Shows what was found
- Asks for confirmation before creating
- Allows adjustments (list price, condition, etc.)

## Auto-Defaults (Email Import Mode)

- **Listing platform**: Amazon UK (always)
- **Purchase mapping**: 1:1 (one purchase per item)
- **List price**: Buy box price rounded DOWN to nearest .49 or .99
- **Condition**: New (Vinted always), New if "sealed/BNIB" in title (eBay)
- **Payment**: Monzo Card (Vinted), PayPal (eBay)

## Workflow

### Step 1: Scan Emails

```bash
# Scan last 7 days of purchase emails
SCAN_RESULT=$(curl -s -H "x-api-key: $HB_SERVICE_API_KEY" \
  "$HB_API_BASE_URL/api/service/purchases/scan-emails?days=7")
```

### Step 2: Filter New Purchases

- Skip any where `already_imported: true`
- Skip any where set_number couldn't be extracted

### Step 3: Enrich Each Item

For each candidate:

```bash
# Get set info from Brickset
BRICKSET=$(curl -s -H "x-api-key: $HB_SERVICE_API_KEY" \
  "$HB_API_BASE_URL/api/service/brickset/lookup?setNumber=$SET_NUMBER")

# Get ASIN
ASIN_RESULT=$(curl -s -H "x-api-key: $HB_SERVICE_API_KEY" \
  "$HB_API_BASE_URL/api/service/inventory/lookup-asin?setNumber=$SET_NUMBER")

# Get buy box price for list price calculation
if [ -n "$ASIN" ]; then
  PRICING=$(curl -s -H "x-api-key: $HB_SERVICE_API_KEY" \
    "$HB_API_BASE_URL/api/service/amazon/competitive-summary?asins=$ASIN")
fi
```

### Step 4: Calculate List Price

```
Buy box: £38.72 → List at: £38.49
Buy box: £45.20 → List at: £44.99
Buy box: £50.00 → List at: £49.99
```

Round DOWN to nearest .49 or .99.

### Step 5A: Scheduled Mode (Automated)

Skip confirmation - proceed directly to creation:

```bash
# Create with automated flag and default storage
curl -s -X POST \
  -H "x-api-key: $HB_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [...],
    "automated": true,
    "storage_location": "TBC"
  }' \
  "$HB_API_BASE_URL/api/service/purchases/batch-import"
```

Then post the morning report to #ai-briefings (see report format in Section 8).

### Step 5B: Manual Mode (Interactive)

Present for confirmation:

```
📦 **Found 3 New Purchases**

**1. Vinted - 75192 Millennium Falcon**
• Cost: £450 from @legoseller123
• Condition: New
• ASIN: B075SDMMMV
• Buy box: £549 → List at: **£548.99**
• Order: 12345678

**2. eBay - 10300 DeLorean (SEALED)**
• Cost: £89 from retrolego_uk
• Condition: New
• ASIN: B09QHZZ5LQ
• Buy box: £139 → List at: **£138.99**
• Order: 12-34567-89012

**3. Vinted - 21330 Home Alone**
• Cost: £155 from brickfan2020
• Condition: New
• ASIN: B09BG3N63L
• Buy box: £199 → List at: **£198.99**
• Order: 87654321

---
All items will list on **Amazon UK**.
Storage location: **[Please specify or use "main shelf"]**

Import all? (yes / no / select specific)
```

### Step 6: Create Records

On confirmation (or automatically in scheduled mode):

```bash
curl -s -X POST \
  -H "x-api-key: $HB_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "source": "Vinted",
        "order_reference": "12345678",
        "seller_username": "legoseller123",
        "set_number": "75192-1",
        "set_name": "Millennium Falcon",
        "cost": 450,
        "purchase_date": "2026-02-03",
        "condition": "New",
        "payment_method": "Monzo Card",
        "amazon_asin": "B075SDMMMV",
        "list_price": 548.99,
        "storage_location": "main shelf"
      }
    ]
  }' \
  "$HB_API_BASE_URL/api/service/purchases/batch-import"
```

### Step 7: Report Success

```
✅ **Imported 3 Purchases**

• 75192 Millennium Falcon → £548.99 (ROI: 22%)
• 10300 DeLorean → £138.99 (ROI: 56%)
• 21330 Home Alone → £198.99 (ROI: 28%)

Total invested: £694
Expected revenue: £886.97
Est. profit: ~£100 after fees

🏷️ All items ready to list on Amazon UK!
```

## Error Handling

**If set number not found in email:**
```
⚠️ Couldn't extract set number from:
"Vintage LEGO Space Set - Great Condition"

Please provide the set number or skip this item.
```

**If ASIN lookup fails:**
```
⚠️ No ASIN found for 75192

Options:
1. Search Amazon manually
2. List on eBay instead
3. Skip and import without ASIN
```

**If buy box unavailable:**
```
⚠️ No buy box price for B075SDMMMV

Using RRP (£649.99) as reference.
Suggested list: £599.99

Adjust? (enter price or "ok")
```

## Conversational Follow-ups

- "import just the first two"
- "change the list price on 75192 to £520"
- "actually, skip the DeLorean"
- "list these on eBay instead"
- "what's the total profit margin?"
```

### SCHEDULE.md Entry

```markdown
| Job | Cron | Channel | Skill | Notes |
|-----|------|---------|-------|-------|
| hb-email-purchases | 0 2 * * * | #ai-briefings | hb-email-purchases | Auto-import purchases at 2am |
```

### Automated Mode (No Confirmation)

When running as a scheduled job during quiet hours, the skill operates in **fully automated mode**:

1. **No user confirmation** - Records are created automatically
2. **Morning report** - Summary posted to #ai-briefings for review
3. **Sensible defaults** - Uses all auto-defaults without prompting
4. **Error collection** - Any failures are reported, not blocking

#### Automated Workflow

```
2:00 AM - Scheduled job starts
    │
    ├─▶ Scan emails (last 24 hours)
    │
    ├─▶ For each new purchase:
    │     ├─▶ Extract set number from email
    │     ├─▶ Brickset lookup (name, theme)
    │     ├─▶ ASIN lookup (Amazon product ID)
    │     ├─▶ Buy box price → calculate list price
    │     ├─▶ Apply auto-defaults
    │     └─▶ Create purchase + inventory (1:1)
    │
    └─▶ Post summary report to #ai-briefings
```

#### Morning Report Format

```
📦 **Overnight Purchase Import** - 3 Feb 2026

**Created 3 records from email:**

✅ **75192 Millennium Falcon** (Vinted)
   Cost: £450 | List: £548.99 | ROI: 22%
   ASIN: B075SDMMMV | Seller: @legoseller123

✅ **10300 DeLorean** (eBay)
   Cost: £89 | List: £138.99 | ROI: 56%
   ASIN: B09QHZZ5LQ | Seller: retrolego_uk

✅ **21330 Home Alone** (Vinted)
   Cost: £155 | List: £198.99 | ROI: 28%
   ASIN: B09BG3N63L | Seller: @brickfan2020

---
📊 **Summary**
• Total invested: £694
• Expected revenue: £886.97 (after fees: ~£780)
• Est. profit: ~£86

⚠️ **Action needed:**
• All items stored at: "TBC" - update storage location
• Ready to list on Amazon UK

---
🔍 **Skipped 1 email** (couldn't extract set number):
• "Vintage LEGO Space Set" from @randomseller
  → Review manually if needed
```

#### Error Report Format

If any imports fail:

```
📦 **Overnight Purchase Import** - 3 Feb 2026

✅ Created 2 records
❌ Failed 1 record

**Successful:**
• 75192 Millennium Falcon - £548.99
• 10300 DeLorean - £138.99

**Failed:**
• 21330 Home Alone
  Error: ASIN lookup timed out
  → Try again: "import 21330 from order 87654321"

**Skipped:**
• 1 email without set number (see above)
```

#### Automated Mode Flag

The batch-import endpoint accepts an `automated: true` flag:

```typescript
interface BatchImportRequest {
  items: Array<{...}>;
  automated?: boolean;      // If true, use all defaults without prompts
  storage_location?: string; // Default for all items (e.g., "TBC")
}
```

When `automated: true`:
- No confirmation required
- Uses "TBC" as storage location if not specified
- Returns full report data for Discord posting
- Logs all actions for audit trail

#### Quiet Hours Consideration

The CLAUDE.md specifies quiet hours as 23:00-06:00. Running at 2am means:
- No Discord notifications wake the user
- Report appears in #ai-briefings for morning review
- User can adjust/fix any issues after reviewing

### Updated Implementation Roadmap

| Phase | Tasks | Time |
|-------|-------|------|
| 1. Database & Auth | Service API keys table + middleware | 1-2 hrs |
| 2. Core Endpoints | Brickset, ASIN, pricing, purchases, inventory | 2-3 hrs |
| 3. Email Scan Endpoint | `/scan-emails` with Vinted/eBay parsing | 1-2 hrs |
| 4. Batch Import Endpoint | `/batch-import` with 1:1 defaults | 1 hr |
| 5. Peter Skill | `hb-email-purchases` skill definition | 1 hr |
| 6. Schedule Entry | Add to SCHEDULE.md (requires Chris) | 5 min |
| 7. Testing | E2E test with real emails | 1 hr |
| **Total** | | **7-10 hrs** |

---

## 9. API Reference Summary (Updated)

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/api/service/brickset/lookup` | GET | read | Look up set by number |
| `/api/service/inventory/lookup-asin` | GET | read | Find ASIN for set |
| `/api/service/amazon/competitive-summary` | GET | read | Batch pricing lookup |
| `/api/service/purchases` | POST | write | Create purchase |
| `/api/service/purchases/{id}` | DELETE | write | Delete purchase (rollback) |
| `/api/service/inventory` | POST | write | Create inventory items |
| `/api/service/purchases/{id}/photos` | POST | write | Upload photos |
| `/api/service/purchases/scan-emails` | GET | read | **Scan Gmail for purchase emails** |
| `/api/service/purchases/batch-import` | POST | write | **Batch create 1:1 records** |
| `/api/service/jobs/history` | GET | read | **Query job execution history** |
| `/api/admin/service-keys` | POST | admin | Generate new API key |

---

## 10. Job Execution History Endpoint

### `GET /api/service/jobs/history`

Query the execution history of all cron jobs. Every job run is logged with start/end time, status, items processed, and any errors.

**Authentication:** `x-api-key` header with `read` permission.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `job_name` | string | (all) | Filter by job name (e.g. `full-sync`, `email-purchases`) |
| `status` | string | (all) | Filter by status: `running`, `completed`, `failed`, `timeout` |
| `since` | ISO date | 24h ago | Only show executions after this time |
| `until` | ISO date | (none) | Only show executions before this time |
| `limit` | number | 50 | Results per page (max 200) |
| `offset` | number | 0 | Pagination offset |

### Available Job Names

| Job Name | Schedule | Description |
|----------|----------|-------------|
| `full-sync` | 7:45am & 1:45pm UTC | Full platform sync |
| `amazon-sync` | Every 5 min | Amazon two-phase feed processing |
| `amazon-pricing` | 4am daily | Amazon pricing sync (resumable) |
| `ebay-pricing` | 2am daily | eBay pricing sync (resumable) |
| `bricklink-pricing` | 2:30am daily | BrickLink pricing sync (resumable) |
| `negotiation` | 8am/12pm/4pm/8pm | eBay automated negotiation |
| `vinted-cleanup` | Midnight | Vinted data cleanup |
| `ebay-fp-cleanup` | 4am daily | eBay false-positive cleanup |
| `refresh-watchlist` | 3am Sunday | Weekly watchlist refresh |
| `retirement-sync` | 6am daily | Retirement data sync |
| `rebrickable-sync` | 4am Sunday | Rebrickable set data sync |
| `investment-sync` | 5am daily | Investment enrichment |
| `investment-retrain` | 6am 1st of month | ML model retraining |
| `email-purchases` | 2:17am daily | Email purchase import |

### Response Format

```json
{
  "data": [
    {
      "id": "uuid",
      "job_name": "email-purchases",
      "trigger": "cron",
      "status": "completed",
      "started_at": "2026-02-11T02:17:00.000Z",
      "completed_at": "2026-02-11T02:17:45.000Z",
      "duration_ms": 45000,
      "items_processed": 3,
      "items_failed": 0,
      "result_summary": { "created": 3, "skipped": 1 },
      "error_message": null,
      "http_status": 200
    }
  ],
  "pagination": {
    "total": 142,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

### Example Usage (Peter)

```bash
# Check if email-purchases ran last night
curl -s -H "x-api-key: $HB_API_KEY" \
  "$HB_API_BASE_URL/api/service/jobs/history?job_name=email-purchases&limit=1" | jq .

# Check all failures in the last 7 days
curl -s -H "x-api-key: $HB_API_KEY" \
  "$HB_API_BASE_URL/api/service/jobs/history?status=failed&since=$(date -d '7 days ago' -Iseconds)" | jq .

# Check all jobs that ran today
curl -s -H "x-api-key: $HB_API_KEY" \
  "$HB_API_BASE_URL/api/service/jobs/history?since=$(date -d 'today 00:00' -Iseconds)&limit=200" | jq .
```
