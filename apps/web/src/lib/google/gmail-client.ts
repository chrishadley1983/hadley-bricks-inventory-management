/**
 * Gmail API client using OAuth2 (user credentials, not service account).
 *
 * Env vars (separate from the Sheets service-account creds):
 *   GOOGLE_GMAIL_CLIENT_ID
 *   GOOGLE_GMAIL_CLIENT_SECRET
 *   GOOGLE_GMAIL_REFRESH_TOKEN
 *
 * Returns null/[] when credentials are missing so callers can fall back
 * to the Hadley API Gmail proxy during local development.
 */

import { google, gmail_v1 } from 'googleapis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailSearchResult {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

let gmailInstance: gmail_v1.Gmail | null = null;

function getGmailClient(): gmail_v1.Gmail | null {
  if (gmailInstance) return gmailInstance;

  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  gmailInstance = google.gmail({ version: 'v1', auth });
  return gmailInstance;
}

/**
 * Check whether direct Gmail credentials are configured.
 */
export function isGmailConfigured(): boolean {
  return !!(
    process.env.GOOGLE_GMAIL_CLIENT_ID &&
    process.env.GOOGLE_GMAIL_CLIENT_SECRET &&
    process.env.GOOGLE_GMAIL_REFRESH_TOKEN
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** Recursively extract the text body from a Gmail message payload. */
function extractBody(payload: gmail_v1.Schema$MessagePart): string {
  let plainText = '';
  let htmlText = '';

  function walk(part: gmail_v1.Schema$MessagePart) {
    const mime = part.mimeType ?? '';

    if (mime === 'text/plain') {
      const data = part.body?.data;
      if (data) plainText += Buffer.from(data, 'base64url').toString('utf-8');
    } else if (mime === 'text/html') {
      const data = part.body?.data;
      if (data) htmlText += Buffer.from(data, 'base64url').toString('utf-8');
    }

    if (part.parts) {
      for (const sub of part.parts) walk(sub);
    }
  }

  walk(payload);

  // Fall back to top-level body if parts didn't yield anything
  if (!plainText && !htmlText) {
    const data = payload.body?.data;
    if (data) {
      const decoded = Buffer.from(data, 'base64url').toString('utf-8');
      if (payload.mimeType === 'text/html') {
        htmlText = decoded;
      } else {
        plainText = decoded;
      }
    }
  }

  return plainText || htmlToText(htmlText);
}

/** Minimal HTML-to-text converter (mirrors Hadley API's _html_to_text). */
function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?(p|div|tr|li|h[1-6])[^>]*>/gi, '\n');
  text = text.replace(/<td[^>]*>/gi, ' | ');
  text = text.replace(/<[^>]+>/g, '');
  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search Gmail messages.
 * Returns [] if credentials are not configured.
 */
export async function searchEmails(query: string, limit = 50): Promise<GmailSearchResult[]> {
  const gmail = getGmailClient();
  if (!gmail) return [];

  const results: GmailSearchResult[] = [];
  let pageToken: string | undefined;

  while (results.length < limit) {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(limit - results.length, 100),
      pageToken,
    });

    const messages = res.data.messages ?? [];
    if (messages.length === 0) break;

    // Fetch metadata for each message (subject, from, date)
    for (const msg of messages) {
      if (!msg.id) continue;
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      results.push({
        id: msg.id,
        threadId: msg.threadId ?? '',
        subject: getHeader(detail.data.payload?.headers, 'Subject'),
        from: getHeader(detail.data.payload?.headers, 'From'),
        date: getHeader(detail.data.payload?.headers, 'Date'),
        snippet: detail.data.snippet ?? '',
      });

      if (results.length >= limit) break;
    }

    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return results;
}

/**
 * Get the full text body of a single email.
 * Returns null if credentials are not configured or the email can't be fetched.
 */
export async function getEmailBody(emailId: string): Promise<string | null> {
  const gmail = getGmailClient();
  if (!gmail) return null;

  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full',
    });

    if (!res.data.payload) return null;
    return extractBody(res.data.payload);
  } catch (err) {
    console.error(`[gmail-client] Failed to fetch email ${emailId}:`, err);
    return null;
  }
}

/**
 * Reset the singleton (useful for testing).
 */
export function resetGmailClient(): void {
  gmailInstance = null;
}
