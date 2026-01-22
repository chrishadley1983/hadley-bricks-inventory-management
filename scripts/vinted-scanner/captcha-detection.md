# CAPTCHA Detection Guide

This document describes the comprehensive CAPTCHA detection strategy for Vinted scanning.

## Detection Methods

### 1. URL-Based Detection

Check if the current URL contains any of these patterns:
- `captcha`
- `captcha-delivery`
- `challenge`
- `blocked`

```javascript
const url = window.location.href.toLowerCase();
const captchaInUrl = [
  'captcha',
  'captcha-delivery',
  'challenge',
  'blocked'
].some(pattern => url.includes(pattern));
```

### 2. DOM Element Detection

Check for the presence of known CAPTCHA elements:

```javascript
const captchaSelectors = [
  'iframe[src*="captcha"]',
  'iframe[src*="challenge"]',
  '[class*="datadome"]',
  '#px-captcha',
  '#challenge-running',
  '.cf-challenge-running',
  '#recaptcha',
  '.g-recaptcha',
  '[data-sitekey]'
];

const captchaInDom = captchaSelectors.some(selector =>
  document.querySelector(selector) !== null
);
```

### 3. Page Title Detection

Check if the page title indicates a block:

```javascript
const title = document.title.toLowerCase();
const captchaInTitle = [
  'blocked',
  'captcha',
  'security',
  'challenge',
  'access denied',
  'please verify',
  'just a moment'
].some(pattern => title.includes(pattern));
```

### 4. Content Detection

Check for CAPTCHA-related text in the page body:

```javascript
const bodyText = document.body?.innerText?.toLowerCase() || '';
const captchaInContent = [
  'please verify you are human',
  'security check',
  'prove you are not a robot',
  'access to this page has been denied',
  'checking your browser'
].some(pattern => bodyText.includes(pattern));
```

## Complete Detection Function

```javascript
function detectCaptcha() {
  // URL check
  const url = window.location.href.toLowerCase();
  if (['captcha', 'captcha-delivery', 'challenge', 'blocked'].some(p => url.includes(p))) {
    return { detected: true, method: 'url' };
  }

  // DOM check
  const captchaSelectors = [
    'iframe[src*="captcha"]',
    'iframe[src*="challenge"]',
    '[class*="datadome"]',
    '#px-captcha',
    '#challenge-running',
    '.cf-challenge-running'
  ];
  for (const selector of captchaSelectors) {
    if (document.querySelector(selector)) {
      return { detected: true, method: 'dom', selector };
    }
  }

  // Title check
  const title = document.title.toLowerCase();
  if (['blocked', 'captcha', 'security', 'challenge'].some(p => title.includes(p))) {
    return { detected: true, method: 'title' };
  }

  return { detected: false };
}
```

## Response When CAPTCHA Detected

When CAPTCHA is detected:

1. **Stop all actions immediately** - do not attempt to interact further
2. **Return the detection result** in the JSON output:

```json
{
  "captchaDetected": true,
  "captchaMethod": "dom",
  "captchaSelector": "[class*=\"datadome\"]",
  "pagesScanned": 0,
  "listings": []
}
```

3. The calling system will:
   - Auto-pause the scanner
   - Send a Pushover notification to the user
   - Log the CAPTCHA event for monitoring

## Known CAPTCHA Providers

Vinted may use these CAPTCHA providers:

### DataDome
- Most common on Vinted
- Detectable by: `[class*="datadome"]`, iframe with datadome in src
- Usually appears as a full-page challenge

### Cloudflare
- Detectable by: `.cf-challenge-running`, "Just a moment" title
- 5-second challenge page

### reCAPTCHA
- Detectable by: `.g-recaptcha`, `[data-sitekey]`
- Usually embedded checkbox or image challenge

### PerimeterX
- Detectable by: `#px-captcha`
- Press and hold challenge

## Prevention Best Practices

To minimise CAPTCHA triggers:

1. **Random delays** - Always wait 3-10 seconds between actions
2. **Natural scrolling** - Scroll slowly with varying speeds
3. **Page dwell time** - Stay on each page 5-15 seconds minimum
4. **Limited pagination** - Never scan more than 3 pages
5. **Operating hours** - Only scan 08:00-22:00 to appear human
6. **Interval variation** - Randomise scan intervals ±20%

## Monitoring CAPTCHA Rate

Track CAPTCHA frequency to detect pattern issues:

```sql
-- Query to check CAPTCHA rate
SELECT
  DATE(created_at) as date,
  COUNT(*) FILTER (WHERE status = 'captcha') as captcha_count,
  COUNT(*) as total_scans,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'captcha') / COUNT(*), 2) as captcha_rate
FROM vinted_scan_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

If CAPTCHA rate exceeds 5%, consider:
- Increasing delays between scans
- Reducing scan frequency
- Pausing scanner for 24 hours
