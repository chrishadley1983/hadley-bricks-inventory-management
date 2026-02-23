# Shopify Upgrade — Morning Handoff

**Date:** 22 Feb 2026
**Status:** All code work complete. Manual Shopify admin tasks remaining.

---

## What's Done

### Theme (Live on hadleybricks.co.uk)
- Brand palette applied (Golden Yellow, Brick Orange, Navy, Green)
- Typography switched to Nunito Sans (headers) + Assistant (body)
- Announcement bar with 3 rotating messages
- Footer restructured with 4 columns
- Full homepage rebuilt (9 sections)
- Page templates created: About, Our Stores, Shipping & Returns
- 404 page enhanced with featured collection
- Theme pushed live at 100%

### Backend Code (All TypeScript-clean, lint-passing)
- `apps/web/src/lib/shopify/` — 7 files:
  - `types.ts` — All TypeScript interfaces
  - `client.ts` — ShopifyClient with OAuth token refresh + rate limiting
  - `pricing.ts` — Price calculator (marketplace price → X.99 Shopify price)
  - `descriptions.ts` — Title, description, tags builders
  - `images.ts` — Image resolution pipeline (eBay → Brickset → Brave)
  - `sync.service.ts` — Full sync engine (create, archive, batch, queue)
  - `index.ts` — Barrel export

### API Routes
- `GET /api/shopify-sync` — Sync status overview
- `POST /api/shopify-sync/create` — Push single item to Shopify
- `POST /api/shopify-sync/archive` — Archive product (item sold)
- `POST /api/shopify-sync/batch` — Batch sync (archive sold + create new)
- `POST /api/shopify-sync/queue` — Process queue jobs
- `PUT /api/shopify-sync/queue` — Enqueue new sync job
- `GET /api/shopify-sync/config` — Get sync config
- `PATCH /api/shopify-sync/config` — Update sync settings

### Admin UI
- Shopify Sync page at `/admin/shopify` (added to sidebar under Admin)
- Status summary cards (total, active, archived, errors, queue)
- Sync controls (batch sync, process queue)
- Config card (sync toggle, auto-sync toggle, discount %, location)

### Database
- 4 new tables: `shopify_config`, `shopify_products`, `shopify_sync_queue`, `shopify_sync_log`
- RLS policies applied
- Shopify credentials stored (shop: 6492ae.myshopify.com)
- Types regenerated

### Blog Posts (Drafted)
- `docs/shopify-content/blog-post-1-restoration.html` — "How We Restore Used LEGO Sets"
- `docs/shopify-content/blog-post-2-investing-retired-lego.html` — "A Guide to Investing in Retired LEGO Sets"

---

## What You Need to Do (Shopify Admin)

These tasks require manual action in the Shopify admin at https://6492ae.myshopify.com/admin

### 1. Create Navigation Menus (5 min)
**Online Store → Navigation**

**Main Menu** (handle: `main-menu`):
- Shop → /collections/all
- New & Sealed → /collections/sealed-sets
- Restored Sets → /collections/restored-used-sets
- Minifigures → /collections/minifigures
- About → /pages/about
- Our Stores → /pages/our-stores

**Quick Links** (handle: `quick-links`):
- Shop All → /collections/all
- New Arrivals → /collections/new-arrivals
- About Us → /pages/about
- Shipping & Returns → /pages/shipping-returns
- Contact → /pages/contact

**Our Stores** (handle: `our-stores`):
- eBay → https://www.ebay.co.uk/str/hadleybricksandkicks
- Amazon → https://www.amazon.co.uk/s?me=A2RXC77QD4YUR2&marketplaceID=A1F83G8C2ARO7P
- BrickLink → https://store.bricklink.com/hadleybric
- Brick Owl → https://hadleybricks.brickowl.com/

### 2. Create Pages (10 min)
**Online Store → Pages**

Create these blank pages and assign their templates:

| Page Title | URL Handle | Template |
|-----------|-----------|----------|
| About | about | page.about |
| Our Stores | our-stores | page.our-stores |
| Shipping & Returns | shipping-returns | page.shipping-returns |
| Contact | contact | page.contact (use Shopify's built-in contact form) |

**For Shipping & Returns page content, paste this into the rich text editor:**

Delivery is via Royal Mail or Hermes, depending on the size and weight of your order.

- Orders over £50: Free tracked shipping
- Standard delivery: £2.99 (2-3 working days)
- Tracked delivery: £3.99 (1-2 working days)

We dispatch within 1-2 business days. You'll receive tracking information by email once your order ships.

**Returns:** If you're not happy with your purchase, contact us within 14 days for a full refund. Items must be in the condition they were received. We cover return shipping if the item is faulty or doesn't match its description.

### 3. Create Collections (10 min)
**Products → Collections**

| Collection Title | Handle | Type | Rules |
|-----------------|--------|------|-------|
| New & Sealed | sealed-sets | Automated | Tag = "New" AND Tag = "Sealed" |
| Restored Sets | restored-used-sets | Automated | Tag = "Used" AND Tag = "Restored" |
| Minifigures | minifigures | Automated | Product type = "Minifigure" |
| New Arrivals | new-arrivals | Automated | Created within last 30 days |
| All Products | all | Automated | All conditions |

### 4. Create Blog Posts (10 min)
**Online Store → Blog posts**

Create a blog called "News" if it doesn't exist, then create 2 posts:

1. Copy HTML from `docs/shopify-content/blog-post-1-restoration.html`
   - Title: "How We Restore Used LEGO Sets"
   - Use the HTML editor (not rich text) to paste the content
   - Add featured image (see Photos section below)

2. Copy HTML from `docs/shopify-content/blog-post-2-investing-retired-lego.html`
   - Title: "A Guide to Investing in Retired LEGO Sets"
   - Use the HTML editor to paste the content
   - Add featured image

### 5. Upload Photos & Replace Placeholders (15-20 min)

The theme currently uses stock placeholder images. You need to upload real photos:

**Homepage Hero Banner:**
- Need: A wide hero shot of your LEGO display/workspace or a selection of sets
- Size: At least 1920x800px, landscape orientation
- Upload at: Online Store → Themes → Customize → Hero Banner section → Image

**Homepage "Our Story" Section:**
- Need: A photo of you working on LEGO (sorting, building, or packaging)
- Size: At least 800x800px
- Upload at: Customize → About Snippet section → Image

**About Page Hero:**
- Need: Same or different workspace/display photo
- Upload at: Customize → page.about template → Hero section → Image

**About Page Restoration Section:**
- Need: Close-up of restoration work (sorting bricks, cleaning, checking pieces)
- Upload at: Customize → page.about template → Restoration section → Image

**Our Stores Page Images:**
- Need: Screenshots or logos for each platform store
- Upload at: Customize → page.our-stores template → Each store section

**Blog Post Featured Images:**
- Post 1: Before/after restoration shot or sorted LEGO parts
- Post 2: Shelf display of sealed retired sets

### 6. Fetch Shopify Location ID (2 min)

The sync engine needs your Shopify location ID to manage inventory. After deploying, run this one-time setup:

1. Navigate to `/admin/shopify` in your HB app
2. Or manually: Go to Shopify Admin → Settings → Locations → note the location ID from the URL
3. Update the config via the admin page

### 7. Configure Apps (5 min)

**Judge.me** — Already installed. Ensure it's configured to display on product pages.

**Instafeed** — Already installed. The homepage template includes an Instafeed section. Make sure your Instagram account is connected.

### 8. Review & Polish Copy (15 min)

All the copy I wrote is a best effort based on what I know about Hadley Bricks. Review and update:

- Homepage hero headline and subtitle
- Homepage trust bar text
- About page story text (I used "Hadley = family surname" as the anchor)
- Buy direct messaging
- Blog post content

---

## Testing the Sync Engine

Once deployed to Vercel:

1. Go to `/admin/shopify` in the HB app
2. Check the config card shows your store connected
3. Click "Run Batch Sync" to push your first products
4. Check Shopify admin → Products to verify they appeared
5. Test archiving: mark an item as SOLD in HB, then run batch sync again

**Note:** The first batch sync will be slow as it resolves images for each product. Subsequent syncs are faster as only new/changed items are processed.

---

## Architecture Notes

- **One-way sync:** HB → Shopify only. Changes made in Shopify admin won't sync back.
- **Pricing:** Shopify price = marketplace price × (1 - discount%). Default 10% off. Rounded to X.99.
- **Images:** Priority: eBay listing photos → Brickset box art → Brave search. Up to 8 images per product.
- **Archiving:** When an item is sold on eBay/Amazon, the Shopify product is archived (not deleted). This preserves SEO value.
- **Queue:** High-priority jobs (archive/delist) process before low-priority ones (new listings). Failed jobs retry with exponential backoff.

---

## Files Created/Modified

### New Files
```
apps/web/src/lib/shopify/types.ts
apps/web/src/lib/shopify/client.ts
apps/web/src/lib/shopify/pricing.ts
apps/web/src/lib/shopify/descriptions.ts
apps/web/src/lib/shopify/images.ts
apps/web/src/lib/shopify/sync.service.ts
apps/web/src/lib/shopify/index.ts
apps/web/src/app/api/shopify-sync/route.ts
apps/web/src/app/api/shopify-sync/create/route.ts
apps/web/src/app/api/shopify-sync/archive/route.ts
apps/web/src/app/api/shopify-sync/batch/route.ts
apps/web/src/app/api/shopify-sync/queue/route.ts
apps/web/src/app/api/shopify-sync/config/route.ts
apps/web/src/hooks/use-shopify-sync.ts
apps/web/src/components/features/shopify-sync/ShopifySyncSummary.tsx
apps/web/src/components/features/shopify-sync/ShopifySyncControls.tsx
apps/web/src/components/features/shopify-sync/ShopifyConfigCard.tsx
apps/web/src/components/features/shopify-sync/index.ts
apps/web/src/app/(dashboard)/admin/shopify/page.tsx
apps/web/src/app/(dashboard)/admin/shopify/loading.tsx
docs/shopify-content/blog-post-1-restoration.html
docs/shopify-content/blog-post-2-investing-retired-lego.html
docs/shopify-content/MORNING-HANDOFF.md
```

### Modified Files
```
apps/web/src/components/layout/Sidebar.tsx  (added Shopify Sync nav link)
packages/database/src/types.ts              (regenerated with shopify tables)
```

### Shopify Theme Files (at C:\Users\Chris Hadley\hadley-bricks-shopify\)
```
config/settings_data.json       (brand palette, typography, colour schemes)
sections/header-group.json      (announcement bar, navigation)
sections/footer-group.json      (4-column footer)
templates/index.json            (9-section homepage)
templates/page.about.json       (About page template)
templates/page.our-stores.json  (Our Stores page template)
templates/page.shipping-returns.json (Shipping page template)
templates/404.json              (enhanced 404)
```
