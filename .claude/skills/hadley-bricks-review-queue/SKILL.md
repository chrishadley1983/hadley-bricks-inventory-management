---
name: hadley-bricks-review-queue
description: >
  Processes the Hadley Bricks Review Queue by identifying LEGO set numbers for
  each purchase and clearing the queue to zero. Use this skill whenever the user
  says "process review queue", "clear the review queue", "check hadley bricks",
  "identify lego sets", "review queue report", or anything related to identifying
  LEGO sets from their Vinted purchases in the Hadley Bricks inventory app.
---

# Hadley Bricks Review Queue Processor

Clears the Purchases → **Review Queue** to zero by identifying the LEGO set
number(s) for every skipped Vinted purchase, then importing or dismissing each.

The work is split into three stages so the deterministic browser work is
scripted and the *identification* is done by Claude's own vision:

1. **SCRAPE** (`fetch`) — pull each seller's Vinted listing photos to disk.
2. **IDENTIFY** (you) — read the saved photos, cross-check Brickset, write `decisions.json`.
3. **APPLY** (`apply`) — import (full enrichment) or dismiss each item, then verify zero.

The engine is committed at **`apps/web/scripts/clear-review-queue.ts`** with three
subcommands: `status`, `check`, `fetch`, `apply`.

> **Why this approach beats the old inbox-scrolling one:** it reads Vinted's own
> `/api/v2/inbox` API for conversations (no flaky sidebar scrolling), drives a
> **dedicated CDP tab** (never disturbs the BrickLink POV backfill loop running in
> the same Chrome), and downloads photos so the operator model (Claude, vision)
> identifies sets directly — far more accurate than a scripted single vision call.

---

## Data model (what the queue is)

- Source of truth: `processed_purchase_emails` where `status='skipped'` and
  `skip_reason='no_set_number'` (Supabase project `modjoikyuhqzouxvieua`).
- An item **leaves** the queue when its status changes:
  - `imported` — set number(s) provided → 1 `purchases` row + N `inventory_items` created.
  - `manual_skip` — dismissed (non-LEGO, packaging, cancelled/refunded).
- There is **no `set_number` column** on this table; the set number lives on the
  created `inventory_items`. The set number must be discovered from the listing.

---

## Prerequisites (check these first)

1. **Local dev server on :3000** — `apply` posts to its
   `/api/purchases/review-queue/[id]/approve` (does full Brickset + ASIN + Keepa
   enrichment, cost allocation, ROI). Start with `npm run dev` if absent.
   Verify: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health` → 200.
2. **CDP Chrome on :9222 logged into the Hadley Bricks Vinted buying account.**
   Run `check` (below). If logged out, **ask the user to log in** on that Chrome —
   you cannot log in for them. Do not fall back to web guesses; photos are the
   primary method.
3. **`.env.local`** with `SUPABASE_*`, `INTERNAL_API_KEY`, `SERVICE_USER_ID`,
   `SERVICE_API_KEY`, `BRICKSET_API_KEY`, `KEEPA_API_KEY`.

Run all commands from `apps/web`:
```
npx tsx scripts/clear-review-queue.ts <status|check|fetch|apply> [--limit N] [--dry-run]
```

---

## Step 1 — Status

```
npx tsx scripts/clear-review-queue.ts status
```
Prints the live `skipped` count (the queue) by source plus all-status totals.

## Step 2 — Verify Vinted login

```
npx tsx scripts/clear-review-queue.ts check     # exit 0 = logged in, 2 = not
```
If it reports logged-out, ask the user to log into Vinted on the :9222 Chrome,
then re-check. (Polling tip: `until npx tsx scripts/clear-review-queue.ts check;
do sleep 25; done` in a background Bash task — match the **exit code**, not text:
"NOT logged in" contains the substring "logged in".)

## Step 3 — Fetch photos

```
npx tsx scripts/clear-review-queue.ts fetch
```
For every skipped item: finds the seller's conversation in the inbox API,
navigates directly to it by id, opens the listing, and downloads up to 8 full-res
(`f800`/`f1600`) photos to `analysis/review-queue/<order_reference>/NN.jpg`.
Writes `analysis/review-queue/manifest.json` (one entry per item with
`id`, `seller_username`, `item_name`, `cost`, `conversation_description`,
`listing_url`, `photo_files`, `note`). Reports `N/M items have photos`.

## Step 4 — Identify (your job — read the photos)

For each manifest entry, `Read` the box-front photo(s) in
`analysis/review-queue/<order_reference>/`. The **set number** is printed on the
box near the LEGO logo / age rating (it may be rotated). Photos that are selfies,
food, etc. are seller clutter — skip to the next.

- **Singles:** read `01.jpg` (front). Read more only if unreadable.
- **Bundles** (title has ` / ` separators, or "Bundle N items"):
  - If `listing_url` is set, it is **one** listing — all sets are in its photos
    (read them all; the listing description often enumerates contents).
  - If `listing_url` is null, it is a **true multi-item bundle**. Fetch the
    conversation `GET /api/v2/conversations/<conversation_id>` → `transaction.item_ids`
    (array). For sold items, `/api/v2/items/<id>` may be empty — instead navigate
    to `https://www.vinted.co.uk/items/<id>` and scrape `f800` images per item
    (open a dedicated CDP tab, `Page.navigate`, then collect `img` srcs).
- **Verify every set number on Brickset before trusting it:**
  ```
  curl -s "http://localhost:3000/api/service/brickset/lookup?setNumber=<N>" -H "x-api-key: $SERVICE_API_KEY"
  ```
  A real set name must come back and match what you see. This catches
  back-of-box misreads.

**Condition rule — classify from evidence; never blanket-default to `Used`.**
The approve API already defaults to **`New`** when `condition` is omitted, so an
unjudged item becomes New (not Used). Most resold Vinted LEGO is sealed, and a
wrong `Used` label both **misprices** the item and **mislabels the Amazon offer**.

- **`New`** — box sealed / shrink-wrapped, or the title/description says "brand
  new" / "BNIB" / "sealed" / "unopened" and the photos don't contradict it.
- **`Used`** — *only on real evidence*: opened or resealed box, built set, opened
  poly-bags, or "used" / "incomplete" / "missing pieces" / visible wear.
- **Ambiguous** — prefer **`New`** (matches the API default) and add the item to
  the **"needs condition review"** list in the report so the user can confirm.
  Do not assume secondhand ⇒ Used.

**Dismiss (don't import) when:** non-LEGO, packaging consumables, or
cancelled/refunded (check Gmail via the "View email" link if unsure).

Write `analysis/review-queue/decisions.json` — an array, one object per queue id:
```json
[
  { "id": "<uuid>", "action": "import",
    "items": [ { "set_number": "41397", "condition": "New" } ],
    "reason": "staceyxx2014: Friends Juice Truck — sealed in photos" },
  { "id": "<uuid>", "action": "import",
    "items": [ {"set_number":"42150"}, {"set_number":"42119"} ],
    "reason": "kazscanlan: Monster Jam pair — condition omitted → defaults to New" },
  { "id": "<uuid>", "action": "import",
    "items": [ { "set_number": "10696", "condition": "Used" } ],
    "reason": "seller3: opened box / loose bags visible → Used" },
  { "id": "<uuid>", "action": "dismiss", "skip_reason": "packaging consumable",
    "reason": "non-LEGO bubble mailers" }
]
```
Build it programmatically from `manifest.json` (map `order_reference → {sets,
condition}`, resolve `id` from the manifest) so ids are never mistyped. Max 10
sets per import.

## Step 5 — Apply

```
npx tsx scripts/clear-review-queue.ts apply --dry-run   # review the plan
npx tsx scripts/clear-review-queue.ts apply             # execute
```
Imports call the local approve endpoint (returns each set's enriched name,
allocated cost, ROI). Dismisses update Supabase directly to `manual_skip`. The
command revalidates against the live queue first, so re-running is safe (already
-resolved ids are skipped).

## Step 6 — Verify zero

```
npx tsx scripts/clear-review-queue.ts status            # expect skipped: 0
```
Then spot-check data integrity in Supabase: every `order_reference` should have
`status='imported'` + a `purchase_id`, with matching `inventory_items.linked_lot`
rows. The set_number you assigned should equal the Brickset-verified set.

## Step 7 — Known gotcha: wrong seeded ASIN names

A few rows in `seeded_asins` map a set to the **wrong** ASIN, so enrichment names
the inventory item after a different set (e.g. `60181` Forest Tractor came through
as "…Yellow Bulldozer 60466"; `40795` Luke BrickHeadz as "…75407 Star Wars Logo").
After applying, scan the created items for an `item_name` whose embedded set number
≠ `set_number`. For each: set `item_name` to the Brickset name and null the wrong
`amazon_asin` + `listing_value` (let the enrichment backfill re-resolve). Track
persistent offenders for the `seeded_asins` cleanup (see asin-audit notes).

---

## Reporting (optional)

If the user wants a report, summarise in chat: imported/dismissed counts, total
inventory value (sum of `listing_value`), and any items needing condition review
or with unresolved enrichment. The legacy HTML email report
(`Review_Queue_Report_YYYY-MM-DD.html` + SMTP send via
`~/.skills/skills/amazon-delivery-performance/smtp_config.json`) is still
available if a formal report is requested.

## Gotchas recap

- **Dedicated tab:** the tool opens its own CDP tab and closes it — never hijack a
  tab the BrickLink POV loop is using.
- **Vinted soft-blocks logged-out scraping** — always use the logged-in session.
- **Sold bundle items:** `/api/v2/items/<id>` can be empty for sold listings;
  scrape the listing page instead.
- **`apply` is idempotent** — safe to re-run after fixing a few failures.
