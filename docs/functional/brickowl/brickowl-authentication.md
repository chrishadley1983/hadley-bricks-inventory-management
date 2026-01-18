# User Journey: Brick Owl Authentication

> **Journey:** Connect your Brick Owl store using API key authentication
> **Entry Point:** Settings > Integrations
> **Complexity:** Low

## Overview

Brick Owl uses simple API key authentication - no complex OAuth flows required. You obtain an API key from your Brick Owl account settings and paste it into the integration form. The system tests the connection before saving.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Settings > Integrations                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Brick Owl                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [Brick Owl Logo]                                                    │   │
│  │                                                                      │   │
│  │ Brick Owl Integration                                                │   │
│  │ Connect your Brick Owl store to sync orders and track               │   │
│  │ transactions.                                                        │   │
│  │                                                                      │   │
│  │ Status: ✕ Not Connected                                             │   │
│  │                                                                      │   │
│  │                                                    [Connect]         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### API Key Authentication

Unlike OAuth-based platforms (eBay, BrickLink), Brick Owl uses a simple API key:

| Aspect | Brick Owl | OAuth Platforms |
|--------|-----------|-----------------|
| Credentials | 1 API key | Multiple tokens |
| Setup | Copy/paste | Authorize flow |
| Expiration | None (until revoked) | Refresh tokens |
| Complexity | Low | High |

### Getting Your API Key

1. Log in to [Brick Owl](https://www.brickowl.com)
2. Go to **My Brick Owl** > **My Store** > **Store Settings**
3. Click **API Keys** tab
4. Create a new API key or copy existing
5. Paste into the connection form

---

## Steps

### 1. Navigate to Integrations

**Action:** Go to Settings > Integrations

**What's Shown:**
- List of available platform integrations
- Current connection status for each
- Connect/Disconnect buttons

### 2. Open Brick Owl Connection

**Action:** Click "Connect" on Brick Owl card

**Connection Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Connect Brick Owl                                                [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Enter your Brick Owl API key to connect your store.                   │
│                                                                         │
│  API Key *                                                              │
│  [_____________________________________________]                        │
│  Your API key from Brick Owl store settings                            │
│                                                                         │
│  ⓘ Find your API key in Brick Owl under                                │
│    My Store > Store Settings > API Keys                                 │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                          [Cancel]  [Test & Connect]     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. Enter API Key

**Action:** Paste your API key from Brick Owl

**Validation:**
- Field is required
- No format validation (keys can vary)
- Whitespace is trimmed

### 4. Test Connection

**Action:** Click "Test & Connect"

**What Happens:**
1. Button shows "Testing..." with spinner
2. API attempts to fetch orders with the key
3. On success: saves encrypted credentials
4. On failure: shows error message

**Success State:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ✓ Brick Owl Connected                                            [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Your Brick Owl store is now connected.                                │
│                                                                         │
│  You can now:                                                           │
│  • Sync orders from Brick Owl                                          │
│  • Track financial transactions                                         │
│  • View order history                                                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                              [Done]     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Failure State:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ✕ Connection Failed                                              [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Could not connect to Brick Owl with the provided API key.             │
│                                                                         │
│  Error: Invalid API key                                                 │
│                                                                         │
│  Please check:                                                          │
│  • API key is copied correctly (no extra spaces)                       │
│  • API key is still active in Brick Owl                                │
│  • Your store has API access enabled                                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                          [Try Again]  [Cancel]          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5. View Connected Status

**Action:** Return to Integrations page

**Connected State:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Brick Owl                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [Brick Owl Logo]                                                 │   │
│  │                                                                  │   │
│  │ Brick Owl Integration                                            │   │
│  │ Your Brick Owl store is connected.                              │   │
│  │                                                                  │   │
│  │ Status: ✓ Connected                                             │   │
│  │ Transactions: 523                                               │   │
│  │ Last Sync: Jan 18, 2026 14:30                                   │   │
│  │                                                                  │   │
│  │                              [Sync Now]  [Disconnect]           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6. Disconnect Account

**Action:** Click "Disconnect"

**Confirmation Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Disconnect Brick Owl                                             [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Are you sure you want to disconnect your Brick Owl account?           │
│                                                                         │
│  This will:                                                             │
│  • Remove your stored API key                                          │
│  • Stop automatic order syncing                                        │
│  • Keep existing synced data                                           │
│                                                                         │
│  You can reconnect at any time.                                        │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                          [Cancel]  [Disconnect]         │
└─────────────────────────────────────────────────────────────────────────┘
```

**What Happens:**
1. API key deleted from `platform_credentials` table
2. Sync config retained (historical data preserved)
3. Status updates to "Not Connected"

---

## Technical Details

### Credential Storage

```typescript
interface BrickOwlCredentials {
  apiKey: string;
}
```

Credentials are encrypted and stored in the `platform_credentials` table:

```sql
INSERT INTO platform_credentials (user_id, platform, credentials_encrypted)
VALUES (user_id, 'brickowl', encrypted_json);
```

### Connection Test

```typescript
async testConnection(): Promise<boolean> {
  try {
    // Try to fetch orders to verify API key works
    await this.getOrders({ limit: 1 });
    return true;
  } catch (error) {
    if (error instanceof BrickOwlApiError) {
      if (error.statusCode === 401 ||
          error.statusCode === 403 ||
          error.code === 'INVALID_KEY') {
        return false;
      }
    }
    throw error;
  }
}
```

### API Request Format

```typescript
// API key is passed as query parameter
const url = new URL(`${BASE_URL}${endpoint}`);
url.searchParams.set('key', this.credentials.apiKey);

const response = await fetch(url.toString(), {
  method: 'GET',
  headers: { Accept: 'application/json' },
});
```

---

## Error Handling

### Common Errors

| Error | Meaning | Solution |
|-------|---------|----------|
| `INVALID_KEY` | API key not recognized | Verify key is correct |
| `401` | Unauthorized | Check API key permissions |
| `403` | Access denied | API access may be disabled |
| `429` | Rate limit | Wait for reset |

### Error Display

```
⚠️ Connection failed
Invalid API key. Please verify your key is correct and active.
[Try Again]
```

---

## Source Files

| File | Purpose |
|------|---------|
| [client.ts](../../../apps/web/src/lib/brickowl/client.ts) | API client with testConnection() |
| [brickowl-sync.service.ts](../../../apps/web/src/lib/services/brickowl-sync.service.ts) | Credential management |
| [credentials.repository.ts](../../../apps/web/src/lib/repositories/credentials.repository.ts) | Encrypted storage |

## Related Journeys

- [Order Sync](./order-sync.md) - Sync orders after connecting
- [BrickLink Authentication](../bricklink/bricklink-authentication.md) - Compare with OAuth 1.0a
- [Settings](../settings/integrations.md) - Other platform integrations
