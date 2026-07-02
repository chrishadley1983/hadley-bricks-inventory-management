/**
 * Vinted Sniper — Background Service Worker
 *
 * Responsibilities:
 *   1. Fetch listing thumbnails (CORS-free via host_permissions on *.vinted.net)
 *      and call Gemini Vision to identify LEGO set numbers + describe the image.
 *   2. Maintain a local mirror of the BrickSet catalog (set_number → theme/name)
 *      for the content script to use as a vision-hallucination guard.
 *
 * Vision prompt is two-shot: returns JSON with setNum, confidence, and 3-5
 * visible features so the caller can validate the identification against the
 * listing title and the catalog's canonical theme.
 */

// Gemini 2.5 Flash (upgraded from flash-lite for better OCR on small thumbs)
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_BACKOFF_MS = 60_000;
const ERR_TRUNC = 500;

// Supabase — usage logging + brickset_sets catalog mirror
const SUPABASE_URL = 'https://modjoikyuhqzouxvieua.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZGpvaWt5dWhxem91eHZpZXVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNDE3MjksImV4cCI6MjA4MTcxNzcyOX0.EWGr0LOwFKFw3krrzZQZP_Gcew13s1Z9H3LxB0-JmPA';

// Catalog refresh policy
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CATALOG_PAGE_SIZE = 1000;
const CATALOG_PARALLEL = 6; // gentle on Supabase, ~5s cold start at 28k rows

function getGeminiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get('geminiKey', data => resolve(data.geminiKey || ''));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'identifyImage') {
    handleIdentify(msg.imageUrl, msg.listingId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'getCatalog') {
    getCatalog(msg.force)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ── Vision identification ─────────────────────────────────────────────

async function handleIdentify(imageUrl, listingId) {
  const geminiKey = await getGeminiKey();
  if (!geminiKey) {
    return { setNum: null, error: 'No Gemini API key configured — set it in extension options' };
  }
  if (!imageUrl || !imageUrl.startsWith('https')) {
    return { setNum: null, error: 'Invalid image URL' };
  }

  const startTime = Date.now();

  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return { setNum: null, error: `Image fetch failed: ${imgRes.status}` };
    }

    const blob = await imgRes.blob();
    const mimeType = blob.type || 'image/jpeg';
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    let res = await callGemini(geminiKey, base64, mimeType);
    let attempts = 1;

    if (res.status === 429) {
      const errText = await res.clone().text().catch(() => '');
      const parsed = parseGeminiError(errText);
      const delayMs = parsed.retryDelaySec ? parsed.retryDelaySec * 1000 : null;
      if (delayMs && delayMs <= MAX_BACKOFF_MS) {
        console.log(`[Gemini] 429 ${parsed.quotaId || ''} — backing off ${parsed.retryDelaySec}s then retrying`);
        await sleep(delayMs);
        res = await callGemini(geminiKey, base64, mimeType);
        attempts = 2;
      }
    }

    const responseTimeMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const parsed = parseGeminiError(errText);
      const summary = formatGeminiError(res.status, parsed, errText);
      logGeminiUsage(GEMINI_MODEL, false, null, responseTimeMs, summary, listingId, { attempts });
      return { setNum: null, error: `Gemini ${summary}` };
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const usage = data.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || null;
    const outputTokens = usage.candidatesTokenCount || null;
    const totalTokens = usage.totalTokenCount || null;

    const parsed = parseVisionJson(text);
    // Confidence gate: anything other than 'high' or 'medium' is rejected.
    // Low confidence is essentially Gemini saying "I'm guessing" — these are
    // the responses that produced hallucinations like 75284 for a red car.
    let setNum = null;
    if (parsed.setNum && (parsed.confidence === 'high' || parsed.confidence === 'medium')) {
      setNum = parsed.setNum;
    }

    logGeminiUsage(GEMINI_MODEL, true, { inputTokens, outputTokens, totalTokens }, responseTimeMs, null, listingId, {
      raw_response: text,
      set_found: !!setNum,
      set_number: setNum,
      confidence: parsed.confidence,
      features: parsed.features,
      attempts,
    });

    return {
      setNum,
      confidence: parsed.confidence,
      features: parsed.features,
      raw: text,
    };
  } catch (e) {
    const responseTimeMs = Date.now() - startTime;
    logGeminiUsage(GEMINI_MODEL, false, null, responseTimeMs, e.message, listingId);
    return { setNum: null, error: e.message };
  }
}

function callGemini(key, base64, mimeType) {
  // Two-shot prompt: number + confidence + features. We force JSON output via
  // responseMimeType so the response is a parseable object, not free-form text.
  const prompt =
    'You are looking at a thumbnail from a Vinted listing for a LEGO product.\n' +
    'Reply ONLY with a JSON object in this exact shape:\n' +
    '{ "setNum": "<4-6 digits or null>", "confidence": "high|medium|low", "features": ["3-5 short visible features"] }\n\n' +
    'Rules for setNum:\n' +
    '- Only return digits you can READ on the image (printed on a box, manual, or label).\n' +
    '- Do NOT guess from set contents, colours, characters, or theme.\n' +
    '- If you cannot READ digits, set setNum to null.\n\n' +
    'Rules for confidence:\n' +
    '- "high": digits are clearly legible.\n' +
    '- "medium": digits are partly visible / blurry but still readable.\n' +
    '- "low": no digits readable, only inferred — use this whenever guessing.\n\n' +
    'Features: 3-5 short visible attributes (e.g. "red sports car", "Eiffel Tower model", "two minifigures", "yellow brick base"). ' +
    'These help validate the identification.';

  return fetch(`${GEMINI_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    })
  });
}

function parseVisionJson(text) {
  // Strip code fences if Gemini ignored responseMimeType.
  let body = text.trim();
  if (body.startsWith('```')) {
    body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  try {
    const obj = JSON.parse(body);
    let setNum = obj.setNum;
    if (typeof setNum === 'number') setNum = String(setNum);
    if (typeof setNum === 'string') {
      const m = setNum.match(/(\d{4,6})/);
      setNum = m ? m[1] : null;
    } else {
      setNum = null;
    }
    let confidence = (obj.confidence || '').toLowerCase();
    if (!['high', 'medium', 'low'].includes(confidence)) confidence = 'low';
    let features = Array.isArray(obj.features) ? obj.features.slice(0, 5).map(String) : [];
    return { setNum, confidence, features };
  } catch {
    // Legacy fallback: model returned bare digits or "UNKNOWN".
    if (/^unknown$/i.test(body)) return { setNum: null, confidence: 'low', features: [] };
    const m = body.match(/\b(\d{4,6})\b/);
    return { setNum: m ? m[1] : null, confidence: 'low', features: [] };
  }
}

function parseGeminiError(body) {
  try {
    const parsed = JSON.parse(body);
    const err = parsed.error || {};
    let retryDelaySec = null;
    let quotaId = null;
    for (const d of err.details || []) {
      const t = d['@type'] || '';
      if (t.endsWith('RetryInfo') && d.retryDelay) {
        const m = d.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
        if (m) retryDelaySec = parseFloat(m[1]);
      }
      if (t.endsWith('QuotaFailure') && d.violations?.[0]) {
        quotaId = d.violations[0].quotaId || d.violations[0].quotaMetric || null;
      }
    }
    return {
      code: err.code || null,
      status: err.status || null,
      message: err.message || null,
      retryDelaySec,
      quotaId,
    };
  } catch {
    return { code: null, status: null, message: null, retryDelaySec: null, quotaId: null };
  }
}

function formatGeminiError(httpStatus, parsed, rawBody) {
  const parts = [];
  if (parsed.status) parts.push(parsed.status);
  if (parsed.quotaId) parts.push(`quota=${parsed.quotaId}`);
  if (parsed.retryDelaySec) parts.push(`retry=${parsed.retryDelaySec}s`);
  if (parsed.message) parts.push(parsed.message);
  const summary = parts.length ? parts.join(' | ') : (rawBody || '').substring(0, ERR_TRUNC);
  return `${httpStatus}: ${summary}`.substring(0, ERR_TRUNC);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── BrickSet catalog mirror ───────────────────────────────────────────

/**
 * Returns { sets, fetched_at } where sets is { "10307": { theme, name }, ... }
 * keyed by digit-only set number (variant suffix stripped). Refreshes from
 * Supabase if missing or older than CATALOG_TTL_MS, unless `force` is true.
 */
async function getCatalog(force = false) {
  const cached = await new Promise(r =>
    chrome.storage.local.get('legoCatalogV2', d => r(d.legoCatalogV2 || null))
  );

  const fresh = cached && cached.fetched_at && (Date.now() - cached.fetched_at) < CATALOG_TTL_MS;
  if (fresh && !force) return cached;

  console.log('[Vinted Sniper] Refreshing brickset catalog…');
  const start = Date.now();
  try {
    const sets = await fetchCatalogPaginated();
    const payload = { sets, fetched_at: Date.now() };
    await new Promise(r => chrome.storage.local.set({ legoCatalogV2: payload }, r));
    const elapsed = Date.now() - start;
    console.log(`[Vinted Sniper] Catalog: ${Object.keys(sets).length} sets in ${elapsed}ms`);
    return payload;
  } catch (e) {
    console.warn('[Vinted Sniper] Catalog refresh failed:', e.message);
    // Fall back to stale cache rather than no catalog at all.
    return cached || { sets: {}, fetched_at: 0 };
  }
}

async function fetchCatalogPaginated() {
  // First request also returns total count via Content-Range header so we can
  // launch the rest in parallel without an unbounded `while not empty` loop.
  const first = await fetchCatalogPage(0, CATALOG_PAGE_SIZE, true);
  const sets = {};
  ingestCatalogRows(sets, first.rows);

  const total = first.total;
  if (!total || first.rows.length >= total) return sets;

  const offsets = [];
  for (let off = CATALOG_PAGE_SIZE; off < total; off += CATALOG_PAGE_SIZE) offsets.push(off);

  for (let i = 0; i < offsets.length; i += CATALOG_PARALLEL) {
    const batch = offsets.slice(i, i + CATALOG_PARALLEL);
    const pages = await Promise.all(batch.map(off => fetchCatalogPage(off, CATALOG_PAGE_SIZE, false)));
    for (const p of pages) ingestCatalogRows(sets, p.rows);
  }
  return sets;
}

function ingestCatalogRows(sets, rows) {
  for (const r of rows) {
    const raw = r.set_number;
    if (!raw) continue;
    // brickset uses "10307-1" format; strip the variant suffix.
    const m = raw.match(/^(\d{4,6})/);
    if (!m) continue;
    const key = m[1];
    // First-seen wins for the digit-only key (variant -1 is the canonical set).
    if (!sets[key]) {
      sets[key] = { theme: r.theme || null, name: r.set_name || null, year: r.year_from || null };
    }
  }
}

async function fetchCatalogPage(offset, limit, withCount) {
  const qs = new URLSearchParams({
    select: 'set_number,theme,set_name,year_from',
    order: 'set_number.asc',
    limit: String(limit),
    offset: String(offset),
  });
  const url = `${SUPABASE_URL}/rest/v1/brickset_sets?${qs}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
  if (withCount) headers['Prefer'] = 'count=exact';

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`brickset_sets ${res.status}`);

  let total = null;
  if (withCount) {
    const range = res.headers.get('Content-Range') || '';
    const m = range.match(/\/(\d+)$/);
    if (m) total = parseInt(m[1], 10);
  }
  const rows = await res.json();
  return { rows, total };
}

// ── Usage logging ─────────────────────────────────────────────────────

function logGeminiUsage(model, success, tokens, responseTimeMs, errorMessage, listingId, extra) {
  const metadata = { listing_id: listingId || null };
  if (extra) Object.assign(metadata, extra);

  const row = {
    consumer: 'vinted-sniper',
    model,
    success,
    response_time_ms: responseTimeMs || null,
    error_message: errorMessage ? errorMessage.substring(0, ERR_TRUNC) : null,
    metadata,
  };

  if (tokens) {
    row.input_tokens = tokens.inputTokens;
    row.output_tokens = tokens.outputTokens;
    row.total_tokens = tokens.totalTokens;
  }

  fetch(`${SUPABASE_URL}/rest/v1/gemini_api_usage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  }).catch(() => {});
}
