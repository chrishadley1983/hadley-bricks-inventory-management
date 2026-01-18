# User Journey: BrickLink Authentication

> **Journey:** Connect and manage BrickLink API credentials
> **Entry Point:** Settings > Integrations
> **Complexity:** Low

## Overview

BrickLink uses OAuth 1.0a authentication, requiring four credential values obtained from the BrickLink developer portal. This journey covers connecting your BrickLink account to enable order syncing and price guide access.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Settings > Integrations                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BrickLink                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [BrickLink Logo]                                                     │   │
│  │                                                                      │   │
│  │ BrickLink Integration                                                │   │
│  │ Connect your BrickLink store to sync orders and access price        │   │
│  │ guide data.                                                          │   │
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

### OAuth 1.0a Credentials

Unlike OAuth 2.0 (used by eBay), BrickLink uses OAuth 1.0a which requires four static credentials:

| Credential | Description | Where to Find |
|------------|-------------|---------------|
| Consumer Key | Your application's identifier | BrickLink API Portal |
| Consumer Secret | Your application's secret | BrickLink API Portal |
| Token Value | Your access token | Generated in API Portal |
| Token Secret | Your token's secret | Generated in API Portal |

### Getting Credentials

1. Go to [BrickLink API Portal](https://www.bricklink.com/v3/api.page)
2. Register as a developer (if not already)
3. Create an API application
4. Generate access tokens for your store
5. Copy all four credential values

---

## Steps

### 1. Navigate to Integrations

**Action:** Go to Settings > Integrations

**What's Shown:**
- List of available platform integrations
- Current connection status for each
- Connect/Disconnect buttons

### 2. Open BrickLink Connection

**Action:** Click "Connect" on BrickLink card

**Connection Dialog:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Connect BrickLink                                                [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Enter your BrickLink API credentials from the BrickLink API Portal.   │
│                                                                         │
│  Consumer Key *                                                         │
│  [_____________________________________________]                        │
│  Your application's consumer key                                       │
│                                                                         │
│  Consumer Secret *                                                      │
│  [_____________________________________________]                        │
│  Your application's consumer secret                                    │
│                                                                         │
│  Token Value *                                                          │
│  [_____________________________________________]                        │
│  Your access token                                                     │
│                                                                         │
│  Token Secret *                                                         │
│  [_____________________________________________]                        │
│  Your token's secret                                                   │
│                                                                         │
│  ⓘ Find these values in your BrickLink API Portal under                │
│    "API Access" > "Manage API Consumers"                               │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                          [Cancel]  [Test & Connect]     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. Enter Credentials

**Action:** Paste credentials from BrickLink API Portal

**Validation:**
- All four fields are required
- Client-side validation ensures non-empty values
- No format validation (credentials can vary)

### 4. Test Connection

**Action:** Click "Test & Connect"

**What Happens:**
1. Button shows "Testing..." with spinner
2. API creates BrickLinkClient with provided credentials
3. Attempts to fetch orders to verify authentication
4. On success: saves encrypted credentials
5. On failure: shows error message

**Success State:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ✓ BrickLink Connected                                            [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Your BrickLink store is now connected.                                │
│                                                                         │
│  You can now:                                                           │
│  • Sync orders from BrickLink                                          │
│  • Access price guide data                                             │
│  • Import transaction history                                          │
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
│  Could not connect to BrickLink with the provided credentials.         │
│                                                                         │
│  Error: Invalid OAuth signature (code: 401)                            │
│                                                                         │
│  Please check:                                                          │
│  • Consumer Key and Secret are correct                                 │
│  • Token Value and Secret are correct                                  │
│  • Your API access is enabled in BrickLink                             │
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
│  BrickLink                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [BrickLink Logo]                                                 │   │
│  │                                                                  │   │
│  │ BrickLink Integration                                            │   │
│  │ Your BrickLink store is connected.                              │   │
│  │                                                                  │   │
│  │ Status: ✓ Connected                                             │   │
│  │ Last Sync: Jan 18, 2026 14:30                                   │   │
│  │ Transactions: 1,234                                             │   │
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
│  Disconnect BrickLink                                             [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Are you sure you want to disconnect your BrickLink account?           │
│                                                                         │
│  This will:                                                             │
│  • Remove your stored credentials                                      │
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
1. Credentials deleted from `platform_credentials` table
2. Sync config retained (historical data preserved)
3. Status updates to "Not Connected"

---

## Technical Details

### Credential Storage

```typescript
interface BrickLinkCredentials {
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
}
```

Credentials are encrypted and stored in the `platform_credentials` table:

```sql
INSERT INTO platform_credentials (user_id, platform, credentials_encrypted)
VALUES (user_id, 'bricklink', encrypted_json);
```

### Connection Test

```typescript
async testConnection(): Promise<boolean> {
  try {
    // Try to fetch orders to verify credentials work
    await this.getOrders({ direction: 'in' });
    return true;
  } catch (error) {
    if (error instanceof BrickLinkApiError) {
      if (error.code === 401 || error.code === 403) {
        return false;
      }
    }
    throw error;
  }
}
```

### OAuth 1.0a Signature

The client generates signatures using HMAC-SHA1:

```typescript
private generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>
): string {
  // Sort and encode parameters
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');

  // Create signature base string
  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&');

  // Create signing key
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;

  // Generate HMAC-SHA1 signature
  const hmac = createHmac('sha1', signingKey);
  hmac.update(signatureBase);
  return hmac.digest('base64');
}
```

### Authorization Header

Each request includes an OAuth header:

```
Authorization: OAuth oauth_consumer_key="xxx",
                     oauth_token="xxx",
                     oauth_signature_method="HMAC-SHA1",
                     oauth_timestamp="1234567890",
                     oauth_nonce="abc123",
                     oauth_version="1.0",
                     oauth_signature="xxx"
```

---

## Error Handling

### Common Errors

| Error Code | Meaning | Solution |
|------------|---------|----------|
| 401 | Invalid credentials | Check all four credential values |
| 403 | Access denied | Ensure API access is enabled |
| 429 | Rate limit exceeded | Wait and retry |
| 500 | BrickLink server error | Try again later |

### Error Display

```
⚠️ Connection failed
Invalid OAuth signature. Please verify your credentials are correct.
[Try Again]
```

---

## Source Files

| File | Purpose |
|------|---------|
| [client.ts](../../../apps/web/src/lib/bricklink/client.ts) | OAuth signature generation |
| [bricklink-sync.service.ts](../../../apps/web/src/lib/services/bricklink-sync.service.ts) | Credential management |
| [credentials.repository.ts](../../../apps/web/src/lib/repositories/credentials.repository.ts) | Encrypted storage |

## Related Journeys

- [BrickLink Uploads](./bricklink-uploads.md) - Track inventory batches
- [Order Sync](./order-sync.md) - Sync sales orders
- [Settings](../settings/integrations.md) - Other platform integrations
