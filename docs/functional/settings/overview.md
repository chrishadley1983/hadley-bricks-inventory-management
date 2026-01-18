# Settings

> Configure platform integrations and manage inventory resolution.

## Purpose

The Settings section provides configuration for external platform integrations and tools for managing inventory-to-order linking. This includes:

- Connecting to selling platforms (eBay, Amazon, BrickLink, Brick Owl, Bricqer)
- Configuring data sources (Brickset, Monzo)
- Resolving inventory linking issues from platform orders

## Settings Pages

| Page | Path | Purpose |
|------|------|---------|
| **Integrations** | `/settings/integrations` | Configure platform credentials |
| **Inventory Resolution** | `/settings/inventory-resolution` | Link sales to inventory items |

## User Journeys

1. [Managing Integrations](./managing-integrations.md) - Connect and configure platforms
2. [Resolving Inventory](./resolving-inventory.md) - Link orders to inventory items

## Feature Components

### Integrations Page

| Section | Purpose |
|---------|---------|
| **BrickLink** | OAuth 1.0a credentials (consumer key, token) |
| **Brick Owl** | API key configuration |
| **Bricqer** | Tenant URL and API key |
| **eBay** | OAuth 2.0 connection status |
| **Amazon** | SP-API credentials |
| **Brickset** | API key for set lookups |
| **Monzo** | Bank account connection |

### Inventory Resolution Page

| Section | Purpose |
|---------|---------|
| **eBay Tab** | Resolve eBay order-to-inventory links |
| **Amazon Tab** | Resolve Amazon order-to-inventory links |
| **Stats Cards** | Pending and resolved counts |
| **Resolution Queue** | Items needing manual linking |

## Technical Architecture

### Credential Storage

Platform credentials are stored securely:
- Encrypted in `platform_credentials` table
- Per-user isolation via user_id
- Decrypted only during API calls

### OAuth Flows

| Platform | Flow |
|----------|------|
| eBay | OAuth 2.0 with refresh tokens |
| BrickLink | OAuth 1.0a |
| Amazon | LWA (Login With Amazon) |

### Resolution Queue

When automatic inventory linking fails, items are queued for manual resolution:

1. **Auto-linking attempted** during order sync
2. **Queue populated** when linking fails
3. **User reviews** suggested matches
4. **Manual selection** or skip/mark as no inventory
5. **Inventory updated** to SOLD status

## API Endpoints

### Integrations

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/integrations/[platform]/credentials` | GET | Check connection status |
| `/api/integrations/[platform]/credentials` | POST | Save credentials |
| `/api/integrations/[platform]/credentials` | DELETE | Remove credentials |
| `/api/integrations/ebay/auth` | GET | Start eBay OAuth |
| `/api/integrations/ebay/callback` | GET | eBay OAuth callback |

### Resolution Queue

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ebay/resolution-queue` | GET | Get eBay queue |
| `/api/ebay/resolution-queue/[id]/resolve` | POST | Resolve item |
| `/api/ebay/resolution-queue/[id]/skip` | POST | Skip item |
| `/api/amazon/resolution-queue` | GET | Get Amazon queue |
| `/api/amazon/resolution-queue/[id]/resolve` | POST | Resolve item |
| `/api/amazon/resolution-queue/[id]/skip` | POST | Skip item |
| `/api/ebay/inventory-linking/process-historical` | POST | Reprocess orders |
| `/api/amazon/inventory-linking/process-historical` | POST | Reprocess orders |

## Source Files

- [Integrations page](../../../apps/web/src/app/(dashboard)/settings/integrations/page.tsx)
- [Inventory Resolution page](../../../apps/web/src/app/(dashboard)/settings/inventory-resolution/page.tsx)

## Related Features

- [eBay Integration](../ebay/overview.md) - eBay order sync
- [Amazon Integration](../amazon/overview.md) - Amazon order sync
- [BrickLink Integration](../bricklink/overview.md) - BrickLink sync
- [Orders](../orders/overview.md) - Order management
