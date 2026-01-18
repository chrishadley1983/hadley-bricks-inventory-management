# Managing Integrations

> Connect and configure selling platform credentials.

## Overview

The Integrations page (`/settings/integrations`) allows you to configure connections to external platforms for order syncing, inventory management, and set lookups.

## Platform Integrations

### eBay

**Authentication**: OAuth 2.0

| Field | Description |
|-------|-------------|
| **Connection Status** | Shows if connected and username |
| **Marketplace** | Connected marketplace (e.g., EBAY_GB) |
| **Expires** | Token expiry date |

**Actions**:
- **Connect**: Redirects to eBay OAuth login
- **Refresh Token**: Manually refresh auth token
- **Disconnect**: Remove connection

### Amazon

**Authentication**: SP-API with LWA

| Field | Description |
|-------|-------------|
| **Client ID** | LWA application ID |
| **Client Secret** | LWA application secret |
| **Refresh Token** | Long-lived refresh token |
| **Seller ID** | Your Amazon seller ID |

**Actions**:
- **Save**: Store credentials
- **Test**: Verify connection works
- **Delete**: Remove credentials

### BrickLink

**Authentication**: OAuth 1.0a

| Field | Description |
|-------|-------------|
| **Consumer Key** | API consumer key |
| **Consumer Secret** | API consumer secret |
| **Token Value** | Access token |
| **Token Secret** | Token secret |

**Actions**:
- **Save**: Store credentials
- **Test Connection**: Verify API works
- **Clear**: Remove credentials

### Brick Owl

**Authentication**: API Key

| Field | Description |
|-------|-------------|
| **API Key** | Your Brick Owl API key |

**Actions**:
- **Save**: Store API key
- **Test Connection**: Verify API works
- **Clear**: Remove API key

### Bricqer

**Authentication**: API Key + Tenant URL

| Field | Description |
|-------|-------------|
| **Tenant URL** | Your Bricqer tenant URL |
| **API Key** | Your Bricqer API key |

**Actions**:
- **Save**: Store credentials
- **Test Connection**: Verify API works
- **Clear**: Remove credentials

### Brickset

**Authentication**: API Key

| Field | Description |
|-------|-------------|
| **API Key** | Brickset API key |

**Actions**:
- **Save**: Store API key
- **Test**: Verify connection
- **Clear**: Remove API key

Used by: Set Lookup feature

### Monzo (Bank Sync)

**Authentication**: OAuth 2.0

| Field | Description |
|-------|-------------|
| **Connection Status** | Connected/Disconnected |
| **Account Type** | Business/Personal |

**Actions**:
- **Connect**: Start Monzo OAuth flow
- **Disconnect**: Remove connection

Used by: Auto-transaction matching

## Connection Status Indicators

| Indicator | Meaning |
|-----------|---------|
| Green checkmark | Connected and working |
| Yellow warning | Connected but needs attention |
| Red X | Not connected or error |
| Grey | Not configured |

## Security

- Credentials are encrypted before storage
- Secrets are never displayed after saving
- Toggle visibility to view/hide sensitive fields
- OAuth tokens are automatically refreshed

## Troubleshooting

### eBay Connection Issues
- Check if token is expired
- Click "Refresh Token" to renew
- If fails, disconnect and reconnect

### Amazon Connection Issues
- Verify all four fields are correct
- Test connection after saving
- Check SP-API access is granted to your app

### BrickLink Connection Issues
- Ensure all four OAuth fields are provided
- Test connection to verify
- Token must have appropriate scopes

## Source Files

- [page.tsx](../../../apps/web/src/app/(dashboard)/settings/integrations/page.tsx)

## API Endpoints

```
GET /api/integrations/bricklink/credentials
POST /api/integrations/bricklink/credentials
DELETE /api/integrations/bricklink/credentials

GET /api/integrations/ebay/credentials
GET /api/integrations/ebay/auth    # Start OAuth
GET /api/integrations/ebay/callback # OAuth callback
DELETE /api/integrations/ebay/credentials
POST /api/integrations/ebay/refresh # Refresh token

GET /api/integrations/amazon/credentials
POST /api/integrations/amazon/credentials
DELETE /api/integrations/amazon/credentials
```
