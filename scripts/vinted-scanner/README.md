# Vinted Scanner - Claude Code Automation

This directory contains prompts and documentation for the automated Vinted LEGO arbitrage scanner.

## Architecture

The scanner operates using Claude Code CLI with Chrome browser automation:

```
┌─────────────────────┐     ┌─────────────────────┐
│  PowerShell/Cron    │────▶│   Claude Code CLI   │
│   (Scheduler)       │     │   --chrome flag     │
└─────────────────────┘     └─────────────────────┘
                                     │
                                     ▼
                            ┌─────────────────────┐
                            │   Chrome Browser    │
                            │   (with session)    │
                            └─────────────────────┘
                                     │
                                     ▼
                            ┌─────────────────────┐
                            │   Vinted Website    │
                            └─────────────────────┘
                                     │
                                     ▼
                            ┌─────────────────────┐
                            │   Process API       │
                            │   /api/arbitrage/   │
                            │   vinted/automation │
                            │   /process          │
                            └─────────────────────┘
```

## Scan Types

### 1. Broad Sweep (`broad-sweep.md`)

Hourly scan of new LEGO listings on Vinted.

- **Frequency**: Every hour, 08:00-22:00
- **URL**: `https://www.vinted.co.uk/catalog?search_text=lego&status_ids[]=6&order=newest_first`
- **Pages**: 1-3 (randomly chosen)
- **COG Threshold**: 40% (configurable)

**Usage**:
```powershell
claude --chrome --prompt (Get-Content .\broad-sweep.md -Raw)
```

### 2. Watchlist Scan (`watchlist-scan.md`)

Targeted scan for specific high-value sets.

- **Frequency**: 5-minute intervals, rotating through 200 sets
- **URL**: `https://www.vinted.co.uk/catalog?search_text=lego+{SET_NUMBER}&status_ids[]=6&order=newest_first`
- **Pages**: 1 only (targeted)
- **COG Threshold**: 40% (configurable)

**Usage**:
```powershell
$setNumber = "75192"
$prompt = (Get-Content .\watchlist-scan.md -Raw) -replace '\{SET_NUMBER\}', $setNumber
claude --chrome --prompt $prompt
```

## Files

| File | Purpose |
|------|---------|
| `broad-sweep.md` | Prompt for hourly broad sweep scans |
| `watchlist-scan.md` | Prompt for targeted watchlist scans |
| `captcha-detection.md` | CAPTCHA detection documentation |
| `README.md` | This file |

## Safety Features

### CAPTCHA Detection
- URL pattern matching
- DOM element detection
- Page title checking
- Auto-pause on detection

### Rate Limiting
- Random delays (2-10 seconds) between actions
- Operating hours restriction (08:00-22:00)
- Maximum 3 pages per broad sweep
- Single page for watchlist scans

### Human Behaviour Simulation
- Random scroll patterns
- Dwell time variation
- Occasional filter toggles (10% chance)
- Randomised timing ±20%

## Output Format

Both scan types return JSON:

```json
{
  "captchaDetected": false,
  "pagesScanned": 2,
  "setNumber": "75192",  // Only for watchlist scans
  "listings": [
    {
      "title": "LEGO Star Wars 75192 Millennium Falcon NEW",
      "price": 450.00,
      "url": "https://www.vinted.co.uk/items/123456..."
    }
  ]
}
```

## Processing Pipeline

1. Claude Code extracts listings from Vinted
2. Scanner script calls `/api/arbitrage/vinted/automation/process`
3. API processes listings:
   - Extracts set numbers from titles
   - Matches to ASINs from seeded_asins table
   - Gets Amazon prices (Buy Box or RRP fallback)
   - Calculates COG%, profit, ROI
   - Stores opportunities in database
   - Sends Pushover notifications for viable deals

## Configuration

Scanner config is stored in `vinted_scanner_config` table:

| Setting | Description | Default |
|---------|-------------|---------|
| `enabled` | Master enable/disable | false |
| `paused` | Temporary pause | false |
| `broad_sweep_cog_threshold` | COG% for broad sweeps | 40 |
| `watchlist_cog_threshold` | COG% for watchlist | 40 |
| `near_miss_threshold` | Upper bound for near-misses | 50 |
| `operating_hours_start` | Start of operating window | 08:00 |
| `operating_hours_end` | End of operating window | 22:00 |

## Troubleshooting

### CAPTCHA Triggered
1. Scanner auto-pauses
2. You receive Pushover notification
3. Open Vinted in regular browser
4. Complete CAPTCHA manually
5. Resume scanner from dashboard

### No Listings Found
- Check if Vinted changed their DOM structure
- Update selectors in `vinted_dom_selectors` table
- Verify the search URL is correct

### High CAPTCHA Rate
- Increase delays in scanner config
- Reduce scan frequency
- Pause scanner for 24 hours

## Environment Variables

Required for scanner operation:

```powershell
# Supabase (for API calls)
$env:NEXT_PUBLIC_SUPABASE_URL = "..."
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "..."

# Pushover (for notifications)
$env:PUSHOVER_USER_KEY = "..."
$env:PUSHOVER_API_TOKEN = "..."
```
