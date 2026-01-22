# Vinted LEGO Watchlist Scan - Set {SET_NUMBER}

You are scanning Vinted UK for a specific LEGO set. Your task is to extract listing information for set number **{SET_NUMBER}**.

## Instructions

1. Navigate to: https://www.vinted.co.uk/catalog?brand_ids[]=89162&search_text={SET_NUMBER}&status_ids[]=6&status_ids[]=1&order=newest_first
2. Wait for the page to fully load
3. Check for CAPTCHA (see detection rules below)
4. If no CAPTCHA, extract all listing cards that match set {SET_NUMBER}
5. Return results as JSON

## CAPTCHA Detection Rules

Check for CAPTCHA if ANY of these conditions are true:
- URL contains "captcha" or "challenge"
- Page title contains "blocked", "captcha", or "verify"
- Page contains an iframe with src containing "datadome" or "captcha"
- Page contains an element with class containing "datadome"

If CAPTCHA is detected, return immediately with `captchaDetected: true`.

## Data Extraction

For each listing card on the page that contains "{SET_NUMBER}" in the title, extract:
- **title**: The listing title text
- **price**: The price as a number (remove £ symbol)
- **currency**: "GBP"
- **url**: The full URL to the listing
- **vintedListingId**: The listing ID from the URL (e.g., /items/123456 -> "123456")

Only include listings where the title contains the set number {SET_NUMBER}.
Ignore listings that mention "compatible", "MOC", "custom", "Block Tech", "Lepin", or similar clone brands.

## Output Format

Output ONLY valid JSON matching the ScanResult schema. Do not include any other text, explanation, or markdown formatting.

```json
{
  "success": true,
  "captchaDetected": false,
  "listings": [
    {
      "title": "LEGO {SET_NUMBER} Complete Set",
      "price": 45.00,
      "currency": "GBP",
      "url": "https://www.vinted.co.uk/items/123456-lego-set",
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

If no listings found for set {SET_NUMBER}:
```json
{
  "success": true,
  "captchaDetected": false,
  "listings": [],
  "pagesScanned": 1
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
