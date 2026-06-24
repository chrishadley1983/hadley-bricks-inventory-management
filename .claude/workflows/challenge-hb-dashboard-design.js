export const meta = {
  name: 'challenge-hb-dashboard-design',
  description: 'Adversarially challenge the Hadley Bricks business-dashboard design across 7 lenses, independently verify each finding, synthesize a prioritized punch-list + an honest "does it look AI-generated" verdict',
  whenToUse: 'After building/redesigning the Hadley Bricks dashboard, to stress-test the visual design before shipping. Reads rendered screenshots (desktop+mobile) + the template source.',
  phases: [
    { title: 'Critique', detail: 'one senior-designer critic per lens, in parallel' },
    { title: 'Verify', detail: 'independently confirm each finding is real and worth acting on' },
    { title: 'Synthesize', detail: 'dedupe + rank into an actionable punch-list' },
  ],
};

const ROOT = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management';
const SHOTS = (args && args.shotsDir) || `${ROOT}/apps/web/scripts/dashboard/shots`;
const TEMPLATE = (args && args.template) || `${ROOT}/apps/web/scripts/dashboard/template.html`;
const SHOTLIST = [`${SHOTS}/desktop-full.png`, `${SHOTS}/mobile-full.png`].join('\n');

const GOALS = [
  'DESIGN GOALS for the Hadley Bricks BUSINESS dashboard (a UK LEGO-resale business selling on Amazon/eBay/BrickLink/Brick Owl + its own Shopify store):',
  '- It is a CONSOLIDATED weekly view for a TIME-POOR business owner: traffic, sales across all channels, SEO/Search Console, Google Merchant feed health, inventory.',
  '- A busy owner must read "how is the business doing + what should I do next" within ~10 seconds from the top (the navy Position card + the KPI strip + the AI-written summary).',
  '- It must NOT look like a generic AI-generated / templated analytics dashboard. It needs a genuine Hadley Bricks brand identity — warm editorial paper, the brick palette (golden yellow / brick orange / navy / green), Fraunces display serif + Inter.',
  '- The STRATEGIC story must be legible: direct (Shopify) vs marketplace revenue share, and AI-assistant search visibility (GEO) — those are the north-star metrics the business is being grown on.',
  '- Data-viz must be HONEST and glanceable; works on mobile (390px).',
].join('\n');

const LENSES = [
  { key: 'hierarchy', brief: 'Visual hierarchy & glanceability — can the owner read the business position + the headline numbers within ~10 seconds? Is the eye guided top-to-bottom? Any competing focal points, dead zones, or buried key metrics?' },
  { key: 'ai-slop', brief: 'AI-slop detector — does ANY part look generic, templated or AI-generated? Be ruthless: default card-grid spacing, predictable 4-tile rows, stock chart styling, evenly-weighted everything, anything that betrays a non-bespoke origin.' },
  { key: 'exec-usefulness', brief: 'Executive usefulness — does it actually answer "how is the business doing + what do I do next" for a busy owner? Are the right KPIs surfaced and the deltas meaningful? Is the AI summary genuinely actionable? Is anything a best-practice ops dashboard would show missing (e.g. conversion rate, margin, week pacing)?' },
  { key: 'brand', brief: 'Brand identity — does it FEEL like Hadley Bricks, a UK LEGO resale business (warmth, the brick palette, editorial craft), or a generic analytics template with a logo slapped on? Is the palette used with intent or decoratively?' },
  { key: 'dataviz', brief: 'Data-viz integrity — chart axis legibility, are delta badges coloured correctly per metric (revenue/traffic up = good/green; SEO avg-position DOWN = good)? Trend honesty (truncated axes?), the by-platform & channel-mix bars, sparse-data charts (the property only has ~9 days of traffic history).' },
  { key: 'typography', brief: 'Editorial craft — the Fraunces (serif) + Inter pairing, type scale, vertical rhythm, alignment, colour discipline, hairline rules, whitespace. Intentionally art-directed or accidental? Numbers tabular-aligned?' },
  { key: 'a11y', brief: 'Accessibility & contrast — cream/ink body contrast and the status-colour chips vs WCAG AA; status conveyed by colour alone; tap-target sizes; mobile stacking (does the 2-col summary collapse cleanly?); legibility of the smallest text and chart axis labels.' },
];

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    lens_summary: { type: 'string', description: '1-2 sentences: overall read on this lens' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          section: { type: 'string', description: 'which element, e.g. "Position card", "Sales tiles", "mobile header", "channel-mix bars"' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'concrete, implementable fix (CSS/markup level where possible)' },
          confidence: { type: 'number' },
        },
        required: ['title', 'section', 'severity', 'problem', 'fix'],
      },
    },
    strengths: { type: 'array', items: { type: 'string' }, description: 'what genuinely works on this lens — preserve these' },
  },
  required: ['lens_summary', 'findings'],
};
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    is_real: { type: 'boolean', description: 'true only if a real user would genuinely benefit from the fix' },
    actionable: { type: 'boolean' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
    verdict: { type: 'string', description: 'why you confirmed or rejected it, citing what you saw' },
    fix: { type: 'string', description: 'the sharpest version of the fix' },
  },
  required: ['title', 'is_real', 'severity', 'verdict'],
};
const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    overall: { type: 'string', description: '3-5 sentence verdict on the dashboard design' },
    looks_ai_generated: { type: 'string', enum: ['no', 'borderline', 'yes'] },
    ai_reasoning: { type: 'string' },
    meets_exec_usefulness: { type: 'boolean', description: 'can a busy owner get position + next-steps at a glance?' },
    strengths: { type: 'array', items: { type: 'string' } },
    punch_list: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'number' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          section: { type: 'string' },
          fix: { type: 'string' },
          effort: { type: 'string', enum: ['trivial', 'small', 'medium', 'large'] },
        },
        required: ['rank', 'title', 'severity', 'fix'],
      },
    },
  },
  required: ['overall', 'looks_ai_generated', 'punch_list'],
};

phase('Critique');
const crit = (await parallel(LENSES.map((L) => () =>
  agent(
    `You are a senior product designer doing a critical review of the Hadley Bricks business dashboard through ONE lens only:\n\n${L.brief}\n\n${GOALS}\n\nRENDERED SCREENSHOTS to read (desktop 1280px + mobile 390px, full-page):\n${SHOTLIST}\n\nSOURCE for implementation detail (read after the images): ${TEMPLATE}\n\nReturn 2-6 concrete findings through your lens. Name the exact section/element. Each finding needs an implementable fix. Be honest about what already works (strengths). Only raise issues a real user would feel — quality over quantity.`,
    { label: `critique:${L.key}`, phase: 'Critique', schema: FINDING_SCHEMA }
  )
))).filter(Boolean);

const findings = crit.flatMap((c, i) => (c.findings || []).map((f) => ({ ...f, lens: LENSES[i].key })));
log(`${findings.length} findings across ${crit.length} lenses`);

phase('Verify');
const verds = (await parallel(findings.map((f) => () =>
  agent(
    `Independently verify this design finding against the actual screenshots + source. Be SKEPTICAL — confirm is_real only if a real user (a busy LEGO-resale business owner) would genuinely benefit. Reject vague, contradictory, or taste-only nits that don't fit the warm-editorial direction.\n\nFINDING: ${f.title}\nLENS: ${f.lens}\nSECTION: ${f.section}\nPROBLEM: ${f.problem}\nPROPOSED FIX: ${f.fix}\n\n${GOALS}\n\nScreenshots:\n${SHOTLIST}\nSource: ${TEMPLATE}`,
    { label: `verify:${(f.section || f.lens).slice(0, 16)}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  ).then((v) => v && ({ ...v, lens: f.lens, section: f.section }))
))).filter(Boolean);

const confirmed = verds.filter((v) => v.is_real);
log(`${confirmed.length}/${verds.length} findings confirmed real`);

phase('Synthesize');
const synth = await agent(
  `You are the design director making the final call on the Hadley Bricks dashboard. Below are independently-verified findings. Produce: an overall verdict, an HONEST call on whether it looks AI-generated (no/borderline/yes) with reasoning, whether a busy owner gets position + next-steps at a glance (meets_exec_usefulness), the strengths to preserve, and a prioritized punch-list (highest user-impact first, with effort estimates).\n\n${GOALS}\n\nCONFIRMED FINDINGS (JSON):\n${JSON.stringify(confirmed, null, 1)}\n\nSTRENGTHS NOTED BY CRITICS:\n${JSON.stringify(crit.flatMap((c) => c.strengths || []))}`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA }
);

return { findings_total: findings.length, confirmed_real: confirmed.length, synthesis: synth };
