# Vinted Scanner: Claude Browser Integration

> **Technical Overview:** How the Vinted Scanner uses Claude CLI with Claude Browser (`--chrome` flag) to automate Vinted scraping safely.

## Executive Summary

The Vinted Scanner is an automated arbitrage tool that scans Vinted.co.uk for mispriced LEGO sets. Rather than using traditional scraping techniques (which are easily detected), it uses **Claude CLI** with the **`--chrome` flag** (Claude Browser) to perform browser-based automation through a real Chrome session.

This approach provides significant advantages:
- **Real browser fingerprint** - Indistinguishable from genuine Chrome user
- **Residential IP** - Uses your home network, not data centre IPs
- **Authentic session** - Real cookies, real login, real JavaScript execution
- **Human-like behaviour** - Claude naturally varies timing and interactions

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WINDOWS PC (User's Local Machine)                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              HadleyBricksScanner.exe (.NET 8 Tray App)               │   │
│  │                                                                       │   │
│  │  ┌────────────────┐     ┌─────────────────┐     ┌─────────────────┐ │   │
│  │  │SchedulerEngine │────►│ ClaudeExecutor  │────►│   Claude CLI    │ │   │
│  │  │                │     │                 │     │ (npm package)   │ │   │
│  │  │• 30s main loop │     │• Load prompt    │     │                 │ │   │
│  │  │• Config poll   │     │• Pass via stdin │     │ Flags:          │ │   │
│  │  │• Heartbeats    │     │• Parse JSON     │     │ --chrome        │ │   │
│  │  │• Execute scans │     │• Handle timeout │     │ --print         │ │   │
│  │  └───────┬────────┘     └─────────────────┘     │ --output-format │ │   │
│  │          │                                       │  json           │ │   │
│  │          │ Results                               └────────┬────────┘ │   │
│  │          ▼                                                │          │   │
│  │  ┌────────────────┐                                       │          │   │
│  │  │   ApiClient    │                          ┌────────────┘          │   │
│  │  │                │                          ▼                       │   │
│  │  │• POST results  │                   ┌─────────────────┐            │   │
│  │  │• GET config    │                   │ Chrome Browser  │            │   │
│  │  │• Heartbeats    │                   │ (Claude Browser │            │   │
│  │  └───────┬────────┘                   │  takes control) │            │   │
│  │          │                            └────────┬────────┘            │   │
│  └──────────┼─────────────────────────────────────┼─────────────────────┘   │
│             │                                     │                         │
└─────────────┼─────────────────────────────────────┼─────────────────────────┘
              │                                     │
              │ API calls                           │ HTTP requests
              ▼                                     ▼
    ┌──────────────────┐                  ┌──────────────────┐
    │  Supabase API    │                  │  Vinted.co.uk    │
    │  (Vercel hosted) │                  │                  │
    └──────────────────┘                  └──────────────────┘
```

---

## What is Claude Browser?

**Claude Browser** is a built-in capability of Claude CLI that allows Claude to control a real Chrome browser. When you run Claude with the `--chrome` flag, Claude can:

1. **Navigate** to URLs
2. **Read** page content (DOM, text, images)
3. **Interact** with elements (click, type, scroll)
4. **Extract** structured data from pages
5. **Take screenshots** for vision analysis

Unlike traditional web scraping tools, Claude Browser uses a real Chrome instance with:
- Your existing Chrome profile (optional)
- Your system's network connection
- Genuine browser fingerprint
- Full JavaScript execution
- Real mouse and keyboard events

---

## How the Scanner Uses Claude Browser

### Step 1: Schedule Triggers Scan

The `SchedulerEngine` runs a 30-second loop checking if any scans are due:

```csharp
// SchedulerEngine.cs (simplified)
while (!cancellationToken.IsCancellationRequested)
{
    var now = DateTime.Now;
    var dueScan = _schedule.FirstOrDefault(s =>
        !s.Executed &&
        now >= s.ScheduledTime &&
        now < s.ScheduledTime.AddMinutes(5)
    );

    if (dueScan != null)
    {
        await ExecuteScanAsync(dueScan, cancellationToken);
    }

    await Task.Delay(30_000, cancellationToken);
}
```

### Step 2: Load Appropriate Prompt

The `ClaudeExecutor` loads a prompt file based on scan type:

| Scan Type | Prompt File | Purpose |
|-----------|-------------|---------|
| `broad_sweep` | `prompts/broad-sweep.md` | Scan all new LEGO listings |
| `watchlist` | `prompts/watchlist.md` | Scan for specific set number |

For watchlist scans, the `{SET_NUMBER}` placeholder is replaced:

```csharp
// ClaudeExecutor.cs
if (scan.Type == "watchlist" && !string.IsNullOrEmpty(scan.SetNumber))
{
    promptContent = promptContent.Replace("{SET_NUMBER}", scan.SetNumber);
}
```

### Step 3: Invoke Claude CLI

Claude CLI is invoked with specific flags:

```powershell
claude --chrome --print --output-format json --dangerously-skip-permissions
```

| Flag | Purpose |
|------|---------|
| `--chrome` | Enables Claude Browser - Claude controls a real Chrome instance |
| `--print` | Non-interactive mode, outputs result only (no conversation) |
| `--output-format json` | Returns structured JSON: `{"type":"result","result":"..."}` |
| `--dangerously-skip-permissions` | Skips confirmation prompts (required for automation) |

The prompt is passed via **stdin**:

```csharp
// ClaudeExecutor.cs
var startInfo = new ProcessStartInfo
{
    FileName = "claude",
    Arguments = "--chrome --print --output-format json --dangerously-skip-permissions",
    RedirectStandardInput = true,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
    CreateNoWindow = true
};

using var process = new Process { StartInfo = startInfo };
process.Start();

// Write prompt to stdin
await process.StandardInput.WriteLineAsync(promptContent);
process.StandardInput.Close();
```

### Step 4: Claude Executes the Prompt

When Claude receives the prompt, it:

1. **Launches Chrome** (or connects to existing instance)
2. **Navigates** to the Vinted URL specified in the prompt
3. **Waits** for page load
4. **Checks for CAPTCHA** (DataDome detection)
5. **Scrolls** to load more listings (Vinted uses infinite scroll)
6. **Extracts** listing data from the DOM
7. **Closes the browser** (per prompt instructions)
8. **Returns** structured JSON

### Step 5: Parse JSON Response

Claude CLI returns a wrapper JSON:

```json
{
  "type": "result",
  "result": "{\"success\":true,\"captchaDetected\":false,\"listings\":[...]}"
}
```

The `ClaudeExecutor` extracts and parses the inner result:

```csharp
// ClaudeExecutor.cs - ParseOutput method
using var doc = JsonDocument.Parse(output);
var root = doc.RootElement;

if (root.TryGetProperty("type", out var typeElement) && typeElement.GetString() == "result")
{
    if (root.TryGetProperty("result", out var resultElement))
    {
        var resultText = resultElement.GetString();
        return ExtractScanResultFromText(resultText);
    }
}
```

### Step 6: Send Results to API

Parsed results are POSTed to the backend:

```
POST /api/arbitrage/vinted/automation/process
```

The backend then:
- Calculates COG% against Amazon prices
- Stores opportunities in `vinted_opportunities` table
- Sends notifications via Discord webhooks

---

## Prompt Structure

### Broad Sweep Prompt (`broad-sweep.md`)

```markdown
# Vinted LEGO Broad Sweep Scan

You are scanning Vinted UK for LEGO sets. Your task is to extract listing
information from the search results page.

## Instructions

1. Navigate to: https://www.vinted.co.uk/catalog?brand_ids[]=89162&search_text=lego&status_ids[]=6&status_ids[]=1&order=newest_first
2. Wait for the page to fully load
3. Check for CAPTCHA (see detection rules below)
4. If no CAPTCHA, scroll down 3-4 times to load more listings
5. Extract all listing cards from the page
6. **IMPORTANT: Close the browser using browser_close before returning results**
7. Return results as JSON

## CAPTCHA Detection Rules

Check for CAPTCHA if ANY of these conditions are true:
- URL contains "captcha" or "challenge"
- Page title contains "blocked", "captcha", or "verify"
- Page contains an iframe with src containing "datadome" or "captcha"
- Page contains an element with class containing "datadome"

## Data Extraction

For each listing card, extract:
- **title**: The listing title text
- **price**: The price as a number (remove £ symbol)
- **currency**: "GBP"
- **url**: The full URL to the listing
- **vintedListingId**: The listing ID from the URL

## Output Format

Output ONLY valid JSON matching the ScanResult schema:

{
  "success": true,
  "captchaDetected": false,
  "listings": [...],
  "pagesScanned": 1
}
```

### Watchlist Prompt (`watchlist.md`)

Similar structure but searches for a specific set number:

```markdown
# Vinted LEGO Watchlist Scan - Set {SET_NUMBER}

Navigate to: https://www.vinted.co.uk/catalog?brand_ids[]=89162&search_text={SET_NUMBER}&status_ids[]=6&status_ids[]=1&order=newest_first

Only include listings where the title contains the set number {SET_NUMBER}.
Ignore listings that mention "compatible", "MOC", "custom", "Block Tech", "Lepin",
or similar clone brands.
```

---

## Expected JSON Output

### Successful Scan

```json
{
  "success": true,
  "captchaDetected": false,
  "listings": [
    {
      "title": "LEGO Star Wars 75192 Millennium Falcon",
      "price": 450.00,
      "currency": "GBP",
      "url": "https://www.vinted.co.uk/items/123456-lego-star-wars",
      "vintedListingId": "123456"
    },
    {
      "title": "LEGO 10300 DeLorean Back to the Future",
      "price": 85.00,
      "currency": "GBP",
      "url": "https://www.vinted.co.uk/items/789012-lego-delorean",
      "vintedListingId": "789012"
    }
  ],
  "pagesScanned": 1
}
```

### CAPTCHA Detected

```json
{
  "success": false,
  "captchaDetected": true,
  "listings": [],
  "pagesScanned": 0,
  "error": "CAPTCHA detected"
}
```

### Error

```json
{
  "success": false,
  "captchaDetected": false,
  "listings": [],
  "pagesScanned": 0,
  "error": "Page failed to load within timeout"
}
```

---

## Why Claude Browser Instead of Traditional Scraping?

### DataDome Protection

Vinted uses **DataDome**, an enterprise-grade bot detection service that analyses:

| Detection Vector | Traditional Scraping | Claude Browser |
|-----------------|---------------------|----------------|
| **TLS Fingerprint** | Python/Node signature = flagged | Real Chrome = authentic |
| **IP Reputation** | Data centre IPs = flagged | Residential IP = trusted |
| **Browser Fingerprint** | Headless markers detected | Genuine browser |
| **JavaScript Execution** | None or emulated | Full V8 engine |
| **Request Timing** | Programmatic patterns | Human-like variation |
| **Session Cookies** | None or forged | Real logged-in session |

### Risk Comparison

| Approach | Detection Risk | Maintenance |
|----------|---------------|-------------|
| Server-side scraping | **HIGH** - DataDome blocks within hours | High - constant selector updates |
| Headless browser (Puppeteer) | **MEDIUM** - Detectable fingerprints | Medium |
| Browser extension | **LOW-MEDIUM** - User must be active | Low |
| **Claude Browser** | **LOW** - Indistinguishable from user | Low |

---

## Safety Features

### CAPTCHA Auto-Detection

The prompt instructs Claude to check for CAPTCHA before extracting data:

```javascript
// Detection logic embedded in prompt
if (url.includes('captcha') ||
    url.includes('geo.captcha-delivery.com') ||
    document.querySelector('iframe[src*="datadome"]') ||
    document.querySelector('[class*="datadome"]')) {
  return { success: false, captchaDetected: true };
}
```

When CAPTCHA is detected:
1. Scan returns `captchaDetected: true`
2. Scanner automatically pauses
3. User receives Discord notification
4. Manual intervention required

### Timing Randomisation

The schedule system uses seeded randomisation:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Broad sweep timing | Random minute 0-55 within each hour | Avoid predictable patterns |
| Watchlist gaps | 2-8 minutes (randomised) | Natural variation |
| Daily order | Shuffled watchlist | Different sequence each day |

### Rate Limiting

Conservative defaults prevent excessive requests:

| Metric | Value |
|--------|-------|
| Broad sweeps per day | 14 (once per operating hour) |
| Watchlist scans per day | ~200 (one per tracked set) |
| Total page loads | ~214/day |
| Operating hours | 08:00-22:00 (configurable) |

A genuine LEGO buyer could easily do 100+ searches in an active session, so this rate is conservative.

---

## Troubleshooting

### Claude CLI Not Found

If the scanner fails with "Claude not found":

```powershell
# Install Claude CLI globally
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version
```

### Timeout Errors

The scanner has a 300-second (5 minute) timeout. If scans consistently timeout:

1. Check Chrome is not blocked by antivirus
2. Ensure stable internet connection
3. Try running Claude manually to test:

```powershell
claude --chrome -p "Navigate to google.com and tell me the page title"
```

### CAPTCHA Keeps Triggering

If you see frequent CAPTCHAs:

1. **Pause scanner** for 48 hours
2. **Manually browse** Vinted to re-establish trust
3. **Increase timing delays** in configuration
4. **Resume at 50% frequency** initially

### JSON Parse Errors

If scans return "Invalid JSON output":

1. Check prompt files haven't been corrupted
2. Verify Claude CLI is up to date
3. Check logs at `%LOCALAPPDATA%\HadleyBricks\Scanner\logs\`

---

## Configuration Reference

### Environment Variables

The Windows scanner reads API configuration from the backend:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | true | Master switch |
| `paused` | false | Temporary pause |
| `operating_hours_start` | 08:00 | When scanning begins |
| `operating_hours_end` | 22:00 | When scanning stops |
| `broad_sweep_cog_threshold` | 40 | COG% threshold for broad sweep |
| `watchlist_cog_threshold` | 45 | COG% threshold for watchlist |

### File Locations

| Component | Location |
|-----------|----------|
| Scanner executable | `C:\Program Files\HadleyBricks\Scanner\` |
| Prompt files | `{install}\prompts\` |
| Log files | `%LOCALAPPDATA%\HadleyBricks\Scanner\logs\` |
| Config cache | `%LOCALAPPDATA%\HadleyBricks\Scanner\config.json` |

---

## Prerequisites

1. **Windows 10/11** with .NET 8 Desktop Runtime
2. **Claude CLI** installed globally via npm
3. **Chrome browser** installed (Claude Browser uses system Chrome)
4. **Active internet connection** on residential IP
5. **Vinted account** logged in via Chrome (optional but recommended)

---

## Source Files

| File | Purpose |
|------|---------|
| [ClaudeExecutor.cs](../../../apps/windows-scanner/HadleyBricksScanner/ClaudeExecutor.cs) | Claude CLI invocation and JSON parsing |
| [SchedulerEngine.cs](../../../apps/windows-scanner/HadleyBricksScanner/SchedulerEngine.cs) | Scan scheduling and execution loop |
| [broad-sweep.md](../../../apps/windows-scanner/prompts/broad-sweep.md) | Broad sweep prompt template |
| [watchlist.md](../../../apps/windows-scanner/prompts/watchlist.md) | Watchlist scan prompt template |
| [vinted-automation.md](./vinted-automation.md) | User journey documentation |
| [vinted-automation-requirements.md](../../vinted-automation-requirements.md) | Full requirements specification |

---

## Related Documentation

- [Vinted Automation Dashboard](./vinted-automation.md) - User journey and dashboard guide
- [DataDome Security Hardening](../../plans/datadome-security-hardening.md) - Anti-detection measures
- [Vinted Automation Requirements](../../vinted-automation-requirements.md) - Complete specifications

---

*Last updated: January 2026*
