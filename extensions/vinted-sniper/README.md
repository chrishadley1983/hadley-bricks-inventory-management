# Vinted Sniper — Chrome Extension

Monitors Vinted catalog/search pages for LEGO listings, identifies set numbers (title regex +
Gemini Vision fallback), prices them (Supabase `seeded_asin_pricing` → Keepa fallback) and/or
checks BrickLink Part-Out-Value, then sends colour-coded Discord alerts for buy candidates.

This folder is the **canonical source** — Chrome loads the unpacked extension directly from here,
so edits go live on the next extension reload and are version-controlled with the rest of the
Hadley Bricks system.

## Install

1. Open `chrome://extensions`, enable **Developer mode**
2. **Load unpacked** → select this folder (`extensions/vinted-sniper`)
3. Right-click the extension → **Options** and configure (see below). Settings are stored in
   `chrome.storage.local`, which is keyed by extension ID — loading from a new path creates a
   new ID, so settings must be re-entered after a move.
4. Open a `vinted.co.uk/catalog` search tab — the status bar appears at the bottom of the page

## Options (required before first run)

| Setting | Notes |
|---|---|
| Discord Webhook URL | Where alerts land. **Not hardcoded — this repo is public.** |
| Gemini API Key | Vision set-identification fallback ([Google AI Studio](https://aistudio.google.com/apikey)) |
| Keepa API Key | Optional Amazon-price fallback when Supabase misses ([keepa.com/#!api](https://keepa.com/#!api)). Blank = skip Keepa. |
| Default Buy Mode | Mode a fresh tab starts in (see below) |
| POV multiples | Good (amber) ≥ 3× COG, great (green) ≥ 4× by default |
| Poll / refresh / quiet hours | Scan cadence and overnight pause |

## Buy modes (per tab)

Each tab has its own buy mode, switchable live via the clickable chip in the status bar
(persisted in `sessionStorage`, so it survives the auto-refresh):

| Mode | Signal |
|---|---|
| 🛒 **Amazon** | Amazon resale margin (amber ≥ 15%, green ≥ 25%) — original behaviour |
| 🔀 **Hybrid (New)** | Amazon margin **OR** New POV ≥ multiple × COG |
| ♻️ **Used POV** | Used POV ≥ multiple × COG — Amazon/Keepa never called |

COG = Vinted price (incl. buyer protection where shown) + £2.39 postage.
POV = BrickLink 6-month SOLD average (gross), read via the anon-safe `get_pov_public` RPC
(migration `20260622144833`); aggregate "Complete Series" rows are excluded.

## Data flow

- Every per-listing decision is logged to `vinted_sniper_decisions` (with `mode`, POV columns and
  `pov_signal`) for false-negative auditing
- Amazon prices: `seeded_asin_pricing` (anon read) → Keepa search fallback (429-aware pause)
- POV: `get_pov_public` RPC, cached in `chrome.storage.local` (14d hit / 1d miss TTL)
- Set catalog for validation comes from the background service worker (`background.js`), which
  also runs Gemini Vision identification

## Security

No secrets in this folder — the repo is public. The Supabase key committed here is the **anon**
key (public by design; the same key ships in the web app's client bundle). Discord webhook,
Gemini key and Keepa key are entered via Options and live only in `chrome.storage.local`.
