# User Journey: eBay Authentication

> **Journey:** Connect and manage eBay account connection
> **Entry Point:** `/settings/integrations` or OAuth callback
> **Complexity:** Medium

## Overview

The eBay Authentication journey handles connecting and disconnecting the user's eBay seller account using OAuth 2.0 Authorization Code Grant flow. The integration stores credentials securely in Supabase and automatically handles token refresh.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    /settings/integrations                           │
├─────────────────────────────────────────────────────────────────────┤
│  Integrations                                                       │
│  Connect your sales platforms to sync data                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ eBay                                              ⚠ Not Connected│
│  │                                                                 │ │
│  │ Connect your eBay UK seller account to:                        │ │
│  │ • View and manage listings                                     │ │
│  │ • Create AI-powered listings                                   │ │
│  │ • Sync orders and transactions                                 │ │
│  │ • Analyse and optimise listings                                │ │
│  │                                                                 │ │
│  │                                         [Connect eBay Account]  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### OAuth 2.0 Flow

The integration uses eBay's OAuth 2.0 Authorization Code Grant:

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│   User   │     │   App    │     │  eBay    │     │ Supabase │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ Click Connect  │                │                │
     │───────────────▶│                │                │
     │                │                │                │
     │                │ Generate URL   │                │
     │                │ with state     │                │
     │                │                │                │
     │ Redirect to eBay Auth           │                │
     │◀────────────────────────────────│                │
     │                │                │                │
     │ Login + Consent│                │                │
     │───────────────────────────────▶│                │
     │                │                │                │
     │ Callback with code              │                │
     │◀────────────────────────────────│                │
     │                │                │                │
     │                │ Exchange code  │                │
     │                │ for tokens     │                │
     │                │───────────────▶│                │
     │                │                │                │
     │                │ Access + Refresh tokens         │
     │                │◀───────────────│                │
     │                │                │                │
     │                │                │ Store credentials
     │                │                │───────────────▶│
     │                │                │                │
     │ Redirect to success             │                │
     │◀───────────────│                │                │
     │                │                │                │
```

### Required OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `sell.fulfillment.readonly` | Read order data |
| `sell.finances` | Access financial transactions |
| `sell.inventory` | Create and manage listings |
| `sell.account` | Access business policies |
| `sell.analytics.readonly` | Access traffic/views data |

### Token Lifecycle

| Token | Expiry | Notes |
|-------|--------|-------|
| Access Token | ~2 hours | Auto-refresh 10 min before expiry |
| Refresh Token | ~18 months | Requires user re-auth when expired |

---

## Steps

### 1. Navigate to Integrations

**Action:** Go to Settings → Integrations (`/settings/integrations`)

**What Happens:**
1. Page displays all available integrations
2. eBay card shows connection status
3. If not connected, shows "Connect" button
4. If connected, shows username and scopes

### 2. Click Connect eBay

**Action:** Click "Connect eBay Account" button

**What Happens:**
1. App generates OAuth authorization URL with:
   - `client_id` - Your eBay App ID
   - `redirect_uri` - Callback URL
   - `scope` - Required OAuth scopes
   - `state` - Encoded user ID and return URL
2. Browser redirects to eBay login page

**URL Structure:**
```
https://auth.ebay.com/oauth2/authorize
  ?client_id=YOUR_APP_ID
  &response_type=code
  &redirect_uri=https://yourapp.com/api/integrations/ebay/callback
  &scope=https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly ...
  &state=BASE64_ENCODED_STATE
```

### 3. eBay Login and Consent

**Action:** User logs into eBay and grants permissions

**What User Sees:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                          eBay                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Sign in to your eBay account                                       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Email or username                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Password                                                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                                           [Sign In]                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

                            ↓

┌─────────────────────────────────────────────────────────────────────┐
│                          eBay                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Hadley Bricks Inventory wants access to your eBay account          │
│                                                                     │
│  This application will be able to:                                  │
│  ✓ View your selling activity                                       │
│  ✓ Manage your inventory and listings                               │
│  ✓ View your financial data                                         │
│  ✓ View your business policies                                      │
│                                                                     │
│                    [Deny]        [Agree]                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4. Handle OAuth Callback

**Action:** eBay redirects to callback URL with authorization code

**What Happens:**
1. Callback handler receives code and state
2. Validates state parameter (user ID, return URL)
3. Exchanges code for tokens via eBay API
4. Stores credentials in `ebay_credentials` table
5. Redirects to success page or return URL

**Callback URL:**
```
/api/integrations/ebay/callback
  ?code=AUTHORIZATION_CODE
  &state=BASE64_ENCODED_STATE
```

**Token Response from eBay:**
```json
{
  "access_token": "v^1.1#i^1#p^3#...",
  "expires_in": 7200,
  "refresh_token": "v^1.1#i^1#r^1#...",
  "refresh_token_expires_in": 47304000,
  "token_type": "User Access Token"
}
```

### 5. View Connection Status

**Action:** Return to integrations page

**What User Sees:**
```
┌────────────────────────────────────────────────────────────────┐
│ eBay                                              ✓ Connected  │
│                                                                │
│ Connected as: username123                                      │
│ Marketplace: eBay UK (EBAY_GB)                                │
│ Expires: 18 Jan 2028                                          │
│                                                                │
│ Scopes:                                                        │
│ ✓ Fulfillment    ✓ Finances    ✓ Inventory                   │
│ ✓ Account        ✓ Analytics                                  │
│                                                                │
│                                      [Disconnect]              │
└────────────────────────────────────────────────────────────────┘
```

### 6. Disconnect eBay

**Action:** Click "Disconnect" button

**Confirmation Dialog:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Disconnect eBay?                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  This will:                                                         │
│  • Remove your eBay connection                                      │
│  • Stop syncing orders and transactions                             │
│  • Disable listing creation and management                          │
│                                                                     │
│  Your existing data will be preserved.                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Disconnect]                 │
└─────────────────────────────────────────────────────────────────────┘
```

**What Happens:**
1. Deletes credentials from `ebay_credentials` table
2. Shows success toast
3. Updates UI to show disconnected state

---

## Technical Details

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/integrations/ebay/connect` | GET | Get authorization URL |
| `/api/integrations/ebay/callback` | GET | Handle OAuth callback |
| `/api/integrations/ebay/status` | GET | Get connection status |
| `/api/integrations/ebay/disconnect` | POST | Remove connection |

### State Parameter Structure

```typescript
interface EbayAuthState {
  userId: string;
  returnUrl?: string;
  marketplaceId?: EbayMarketplaceId;
}

// Encoded as base64url for URL safety
const state = Buffer.from(JSON.stringify(stateData)).toString('base64url');
```

### Credentials Storage

```sql
CREATE TABLE ebay_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP NOT NULL,
  refresh_token_expires_at TIMESTAMP NOT NULL,
  scopes TEXT[] NOT NULL,
  marketplace_id VARCHAR NOT NULL DEFAULT 'EBAY_GB',
  ebay_user_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Token Refresh Logic

```typescript
// Check if token needs refresh (10 minute buffer)
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

async getAccessToken(userId: string): Promise<string | null> {
  const credentials = await this.getCredentials(userId);
  if (!credentials) return null;

  const expiresAt = new Date(credentials.access_token_expires_at);
  const now = new Date();

  if (expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_BUFFER_MS) {
    // Token expired or about to expire, refresh it
    const refreshed = await this.refreshAccessToken(userId, credentials.refresh_token);
    return refreshed ? refreshed.access_token : null;
  }

  return credentials.access_token;
}
```

---

## Error Handling

### OAuth Denied

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Connection Cancelled                                            │
│  You cancelled the eBay connection. Click Connect to try again.    │
└─────────────────────────────────────────────────────────────────────┘
```

### Invalid State

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Connection Failed                                               │
│  Invalid state parameter. Please try connecting again.             │
│                                                    [Try Again]      │
└─────────────────────────────────────────────────────────────────────┘
```

### Token Exchange Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Connection Failed                                               │
│  Failed to complete eBay connection. Please try again.             │
│                                                    [Try Again]      │
└─────────────────────────────────────────────────────────────────────┘
```

### Refresh Token Expired

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ eBay Connection Expired                                         │
│  Your eBay connection has expired. Please reconnect.               │
│                                          [Reconnect to eBay]        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EBAY_CLIENT_ID` | eBay Application ID (Client ID) |
| `EBAY_CLIENT_SECRET` | eBay Cert ID (Client Secret) |
| `EBAY_REDIRECT_URI` | OAuth callback URL |
| `EBAY_SANDBOX` | Set to 'true' for sandbox environment |

---

## Source Files

| File | Purpose |
|------|---------|
| [ebay-auth.service.ts](apps/web/src/lib/ebay/ebay-auth.service.ts) | OAuth service implementation |
| [callback/route.ts](apps/web/src/app/api/integrations/ebay/callback/route.ts) | OAuth callback handler |
| [connect/route.ts](apps/web/src/app/api/integrations/ebay/connect/route.ts) | Generate auth URL |
| [status/route.ts](apps/web/src/app/api/integrations/ebay/status/route.ts) | Connection status check |

## Related Journeys

- [eBay Stock Management](./ebay-stock-management.md) - Requires connection
- [Listing Creation](./listing-creation.md) - Requires connection
- [Listing Optimiser](./listing-optimiser.md) - Requires connection
- [eBay Transaction Sync](./ebay-transaction-sync.md) - Requires connection
