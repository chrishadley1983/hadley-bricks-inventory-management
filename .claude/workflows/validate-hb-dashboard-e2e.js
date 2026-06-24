export const meta = {
  name: 'validate-hb-dashboard-e2e',
  description: 'Full E2E validation of the live Hadley Bricks dashboard on surge: passcode gate security, headless unlock+render, data freshness/integrity vs live sources, mobile — adversarial verify + PASS/FAIL',
  whenToUse: 'After deploying the Hadley Bricks dashboard to surge, to confirm it serves, the AES passcode gate works and leaks no plaintext, the dashboard renders fully, and the data is real + fresh.',
  phases: [
    { title: 'Validate', detail: 'probe surge + drive a real headless browser + cross-check data' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN' },
    { title: 'Synthesize', detail: 'PASS/FAIL report' },
  ],
};

const URL = (args && args.url) || 'https://hadley-bricks-dashboard.surge.sh';
const PASS = (args && args.passcode) || 'HadleyBricks2026';
const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management';

const CTX = `
CONTEXT — validate the LIVE Hadley Bricks business dashboard.
URL: ${URL}  (AES-GCM passcode-gated; passcode for testing: "${PASS}")
The dashboard is a single static page published to surge. The data is AES-encrypted into the page; a client-side PBKDF2+AES-GCM gate decrypts it in-browser on passcode submit (the passcode is NEVER in the HTML). It shows: a Position card with an AI-written summary + KPI strip, Sales (all channels), Traffic & AI visibility (GA4), Search Console, Merchant feed health, Inventory. Generator/data: ${REPO}/apps/web/scripts/dashboard/ (build-dashboard.ts, data.ts, template.html). For a read-only live data pull, write a throwaway tsx in scripts/dashboard/ that imports { buildDashboardData } from './data' and prints the result, run with: cd ${REPO}/apps/web && npx tsx --env-file=.env.local scripts/dashboard/<your>.ts

ENVIRONMENT: Playwright (node) is available from the repo root node_modules (import { chromium } from 'playwright'); chromium.launch() may need a fallback to chromium.connectOverCDP('http://127.0.0.1:9222'). file://-vs-https: the live URL is https so WebCrypto works. Write throwaway scripts (_e2e-*.mjs / .ts), clean up after.

RULES: Be INDEPENDENT + ADVERSARIAL. Actually DRIVE the page in a real browser, don't just curl. Read-only — never deploy or mutate. Report concrete evidence.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'problem'], properties: { item: { type: 'string' }, problem: { type: 'string' } } } },
  },
};

const DIMENSIONS = [
  {
    key: 'gate-security',
    prompt: `Confirm the passcode gate is secure. (1) The URL returns 200 text/html. (2) The raw HTML (curl) contains the gate ("Hadley Bricks", passcode input, "Unlock") and an encrypted payload (payload:"..." base64), but ZERO plaintext business data — grep the raw HTML for any actual numbers/figures, set numbers, query strings, revenue, "Amazon"/"eBay" sales values, the word "position" summary text, etc. If any decrypted business data is visible in the served HTML without unlocking, that is a CRITICAL leak -> FAIL. (3) A wrong passcode in a real browser must NOT reveal data (shows "Incorrect passcode"). (4) The surge 200.html SPA fallback returns 200 for an arbitrary path. Verdict FAIL on any plaintext leak.`,
  },
  {
    key: 'unlock-render',
    prompt: `Drive the live page in a real headless browser (Playwright). (1) Load ${URL}; confirm the gate shows. (2) Enter the correct passcode "${PASS}", submit, and confirm the dashboard unlocks and #app becomes visible. (3) Confirm ALL sections render: Position card with a non-empty AI summary + KPI strip, Sales, Traffic & AI visibility, Search Console, Merchant feed, Inventory. (4) Confirm the two Chart.js charts actually draw (canvas has non-blank pixels / a Chart instance) and are NOT absurdly tall (the known bug). (5) Capture console errors — there must be none that break rendering. Verdict FAIL if it doesn't unlock or a section/chart is missing/broken.`,
  },
  {
    key: 'data-integrity',
    prompt: `Confirm the dashboard shows REAL, FRESH data (not placeholders/stale). Unlock in a browser and read the rendered values, then independently pull the live data (write a throwaway tsx importing buildDashboardData from ./data, run with --env-file=.env.local) and cross-check: the Merchant feed approved/total, the inventory listed count, and the sales 7d revenue should match the dashboard (allowing for the dashboard being built slightly earlier). Confirm the "Updated …" timestamp / generatedAt is recent (within ~8 days). Verdict FAIL if values are obviously placeholder, zero across the board, or stale (>8 days), or contradict the live pull beyond normal drift.`,
  },
  {
    key: 'mobile',
    prompt: `Render the unlocked page at mobile width (viewport 390x844) in a real browser and full-page screenshot. Confirm: the 2-column Position summary collapses to a single column, no horizontal overflow, the charts are correctly sized (NOT stretched tall — the previously-fixed bug), tables remain readable, tap targets are reasonable. Verdict FAIL on overflow or broken/over-tall charts.`,
  },
];

phase('Validate');
const findings = (await parallel(DIMENSIONS.map((d) => () =>
  agent(`${CTX}\n\nDIMENSION: ${d.key}\n${d.prompt}\n\nReturn your finding via the schema.`, { label: `validate:${d.key}`, phase: 'Validate', schema: SCHEMA })
))).filter(Boolean);

phase('Verify');
const concerning = findings.filter((f) => f.verdict !== 'PASS');
const verifications = await parallel(concerning.map((f) => () =>
  agent(
    `${CTX}\n\nA validator reported "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nIssues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently reproduce against the LIVE dashboard in a real browser. Decide if each issue is a REAL defect (gate leak, broken render, stale/placeholder data, mobile overflow) or a false positive. Default to "real" only if reproduced.`,
    {
      label: `verify:${f.dimension}`,
      phase: 'Verify',
      schema: { type: 'object', additionalProperties: false, required: ['dimension', 'confirmedReal', 'verdict', 'explanation'], properties: { dimension: { type: 'string' }, confirmedReal: { type: 'boolean' }, verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] }, explanation: { type: 'string' } } },
    }
  )
));

phase('Synthesize');
const report = await agent(
  `${CTX}\n\nSynthesize the FINAL E2E verdict for the live Hadley Bricks dashboard.\n\nFINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS:\n${JSON.stringify(verifications, null, 2)}\n\nProduce: overall PASS / PASS-WITH-NOTES / FAIL; one line per dimension; whether (a) the gate is secure with no plaintext leak, (b) it unlocks + renders fully, (c) the data is real + fresh, (d) mobile is clean; and any CONFIRMED-REAL defect with severity + action.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('HB dashboard E2E validation complete.');
return { findings, verifications, report };
