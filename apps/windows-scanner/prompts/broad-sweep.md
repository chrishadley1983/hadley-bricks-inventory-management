# Vinted LEGO Broad Sweep Scan

You are scanning Vinted UK for LEGO sets. Your task is to extract listing information from the search results page.

## Instructions

1. Navigate to: https://www.vinted.co.uk/catalog?brand_ids[]=89162&order=newest_first
2. Wait for the page to fully load
3. Check for CAPTCHA (see detection rules below)
4. If no CAPTCHA, extract all listing cards from the current page
5. Return results as JSON

## CAPTCHA Detection Rules

Check for CAPTCHA if ANY of these conditions are true:
- URL contains "captcha" or "challenge"
- Page title contains "blocked", "captcha", or "verify"
- Page contains an iframe with src containing "datadome" or "captcha"
- Page contains an element with class containing "datadome"

If CAPTCHA is detected, return immediately with `captchaDetected: true`.

## Data Extraction

For each listing card on the page, extract:
- **title**: The listing title text
- **price**: The price as a number (remove £ symbol)
- **currency**: "GBP"
- **url**: The full URL to the listing
- **vintedListingId**: The listing ID from the URL (e.g., /items/123456 -> "123456")

## Output Format

Output ONLY valid JSON matching the ScanResult schema. Do not include any other text, explanation, or markdown formatting.

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
    }
  ],
  "pagesScanned": 1
}
```

If CAPTCHA is detected:
```json
{
  "success": false,
  "captchaDetected": true,
  "listings": [],
  "pagesScanned": 0,
  "error": "CAPTCHA detected"
}
```

If an error occurs:
```json
{
  "success": false,
  "captchaDetected": false,
  "listings": [],
  "pagesScanned": 0,
  "error": "Description of the error"
}
```

Output ONLY valid JSON matching the ScanResult schema.
