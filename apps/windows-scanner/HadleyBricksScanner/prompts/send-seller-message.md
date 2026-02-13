# Vinted Seller Message - Send to {SELLER_USERNAME}

You are sending a message to a Vinted seller. Your task is to navigate to the conversation with **{SELLER_USERNAME}** and send a specific message.

## Message to Send

```
{MESSAGE_TEXT}
```

## Instructions

### Step 1: Navigate to Inbox
1. Navigate to: https://www.vinted.co.uk/inbox
2. Wait for the page to fully load
3. Check for CAPTCHA (see detection rules below)

### Step 2: Find the Seller's Conversation
1. Look through the conversation list for a conversation with **{SELLER_USERNAME}**
2. The conversation should be recent (near the top) since this is a new purchase
3. Click on the conversation to open it

### Step 3: If Conversation Not Found (Fallback)
If you cannot find {SELLER_USERNAME} in the inbox:
1. Navigate to: https://www.vinted.co.uk/member/{SELLER_USERNAME}
2. Wait for the profile page to load
3. Click the "Message" button on their profile
4. This will open a new conversation

### Step 4: Send the Message
1. Click on the message input field / text area
2. Type the exact message shown above (copy it exactly, including line breaks if any)
3. Press Enter or click the Send button to send the message
4. Wait 2 seconds to confirm the message appears in the conversation

### Step 5: Verify and Close
1. Verify the message appears in the conversation (look for your sent message bubble)
2. **IMPORTANT: Close the browser using browser_close before returning results**
3. Return the result as JSON

## CAPTCHA Detection Rules

Check for CAPTCHA if ANY of these conditions are true:
- URL contains "captcha" or "challenge"
- Page title contains "blocked", "captcha", or "verify"
- Page contains an iframe with src containing "datadome" or "captcha"
- Page contains an element with class containing "datadome"

If CAPTCHA is detected, return immediately with `captchaDetected: true`.

## Output Format

Output ONLY valid JSON. Do not include any other text, explanation, or markdown formatting.

Success:
```json
{
  "success": true,
  "captchaDetected": false,
  "messageSent": true,
  "sellerUsername": "{SELLER_USERNAME}",
  "error": null
}
```

If CAPTCHA detected:
```json
{
  "success": false,
  "captchaDetected": true,
  "messageSent": false,
  "sellerUsername": "{SELLER_USERNAME}",
  "error": "CAPTCHA detected"
}
```

If seller conversation not found (both inbox and profile fallback failed):
```json
{
  "success": false,
  "captchaDetected": false,
  "messageSent": false,
  "sellerUsername": "{SELLER_USERNAME}",
  "error": "Could not find conversation with seller"
}
```

If an error occurs:
```json
{
  "success": false,
  "captchaDetected": false,
  "messageSent": false,
  "sellerUsername": "{SELLER_USERNAME}",
  "error": "Description of the error"
}
```

Output ONLY valid JSON.
