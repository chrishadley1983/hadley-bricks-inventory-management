export const meta = {
  name: 'validate-bl-store-report',
  description: 'E2E-validate the common BL store decision report (PR #620): canonical constants adoption, engine v7 fields, honesty-ladder invariants on live data, CLI views, lens wiring + Discord headline, deploy health',
  whenToUse: 'After merging + deploying the bl-store-report module, to confirm every store surface renders through it consistently and the demand-cap/liquid maths hold on real persisted stores.',
  phases: [
    { title: 'Validate', detail: 'constants · engine v7 · live invariants · CLI views · wiring/deploy' },
    { title: 'Verify', detail: 'adversarially refute each finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL verdict' },
  ],
};

const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management';
const WEB = `${REPO}/apps/web`;
const PROD_URL = 'https://hadley-bricks-inventory-management.vercel.app';

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'pass', 'summary', 'findings'],
  properties: {
    dimension: { type: 'string' },
    pass: { type: 'boolean' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'claim', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
          claim: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['upheld', 'reasoning'],
  properties: {
    upheld: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
};

const DIMENSIONS = [
  {
    key: 'constants',
    prompt: `Validate that the canonical constants module is the ONLY source of the BL store-review economics, on main at ${REPO}.
1. Read apps/web/src/lib/bricklink/fees.ts — confirm it exports BL_FEE 0.03, BRICQER_FEE 0.035, PAYPAL_PCT 0.029, VAR_FEE_PCT (sum), STR_GATES [0,0.25,0.5,0.75,1.0], LIQUID_STR_GATE 0.25, MAGNET {maxSupplyLots:3,minStr:0.5}, PRICE_BANDS.
2. Grep the whole repo (apps/web/src + apps/web/scripts) for RE-DECLARATIONS that bypass it: literal "0.094" as a fee, "const BL_FEE"/"const BRICQER_FEE"/"const PAYPAL_PCT"/"const VAR_FEE_PCT" outside fees.ts, and hardcoded gate arrays "[0, 0.25, 0.5" outside fees.ts. store-quality/pricing.ts must RE-EXPORT from fees, not declare.
3. Confirm bl-basket.ts, bl-pg-store-scan.ts, bl-store-assessment/types.ts (DEFAULT_INPUTS), bl-store-assessment/engine.ts (PRICE_BANDS, STR_GATES) all import from the canonical module.
pass=true only if there are ZERO bypassing re-declarations. Return structured findings with file:line evidence.`,
  },
  {
    key: 'engine-v7',
    prompt: `Validate the assessment engine v7 additions on main at ${REPO}.
1. apps/web/src/lib/bl-store-assessment/engine.ts: ENGINE_VERSION === 7; scoreLot sets marketSoldQty6mo (null when no benchmark — NOT 0) and soldShareAtList (UK provenance + ourList present only); assembleAssessmentWithLots/computeStoreAssessmentWithLots return {assessment, scoredLots}; plain assembleAssessment/computeStoreAssessment still return the bare assessment (back-compat for all existing callers — check batch.ts and any other engine callers still compile against the old signature).
2. Run the unit suite: cd "${WEB}"; npx vitest run src/lib/bl-store-assessment src/lib/bl-store-report — all tests must pass.
3. Confirm ScoredLot type carries the v7 fields as OPTIONAL (old persisted jsonb rows lack them) and that lib/bl-store-report/compute.ts handles their absence (marketSoldQty6mo undefined -> cappedQty null -> cappedLotNet falls back to full qty, never NaN).
pass=true only if all hold. Structured findings with evidence.`,
  },
  {
    key: 'live-invariants',
    prompt: `Validate the honesty-ladder maths on LIVE persisted data. Working dir: ${WEB} (has .env.local).
Run: npx tsx scripts/store-report.ts --slug=Blanco_Brix --json > "%TEMP%/blanco-report.json" (or a scratch path; stderr carries progress, stdout is the JSON DecisionReport).
Then verify these invariants on the parsed JSON (write a small node/tsx script; do NOT eyeball):
1. summary.rawNet >= summary.cappedNet - 0.5 (cap can only reduce, modulo per-lot rounding).
2. summary.cappedNet >= summary.liquidNet - 0.5 (liquid is a filtered subset of capped rows... NOTE: only guaranteed if every excluded row has non-negative cappedLotNet — check and report if negative-capped rows exist and whether the inequality still holds; if it legitimately fails because excluded rows are net-negative, that is NOT a defect, document it).
3. Every row: cappedQty == null OR cappedQty <= qty; cappedLotNet consistent with netPerUnit * (cappedQty ?? qty) within 2p; benchProvenance in {uk,world,none}; strQty null or >= 0.
4. Gate ladder: lots monotonically non-increasing as gate rises; each gate's cappedNetNoDups <= cappedNet + 0.01.
5. summary.coverage.ukLots + worldLots + noneLots == coverage.totalLots.
6. Rows are sorted by cappedLotNet descending.
7. Sanity anchor: with --pricing-lens=grounded the LIQUID figure printed by the CLI run should be ~£17.31 (the hand-derived Jul-19 Blanco_Brix figure was £17.30; anything within ±£2 passes — caches move daily; a large deviation is a finding, not an auto-fail, but must be reported with the actual number).
Also run once on a SECOND store with a stored scrape (pick any recent slug from bl_store_scrapes via a quick supabase query or reuse tmp/stores listing) to prove it generalises.
pass=true only if invariants 1-6 hold on both stores. Structured findings.`,
  },
  {
    key: 'cli-views',
    prompt: `Validate the store-report CLI views on live data. Working dir: ${WEB}.
1. --magnets: run npx tsx scripts/store-report.ts --slug=Blanco_Brix --magnets --json; every returned row must have magnet===true, and the row count must be <= the unfiltered run's summary.magnetLots (magnetLots counts unfiltered buy rows).
2. --min-str=1: every row strQty >= 1.
3. --no-dups: no row with overlap === 'DUPLICATE'.
4. --from-assessment: runs without error and the meta carries partialRows === true (it renders from the persisted top-N union).
5. Default run writes tmp/stores/Blanco_Brix/store-report-<today>.md; the md contains the sections "## Headline", "## Decision table", "## Gate ladder", "## Conventions", and its decision-table row count equals the JSON rows length (md renders EVERY row, no cap).
pass=true only if all five behave. Structured findings.`,
  },
  {
    key: 'wiring-deploy',
    prompt: `Validate the wiring + deploy of the bl-store-report merge (PR #620, merge commit 7810ef18) at ${REPO}.
1. git: confirm origin/main contains commit 7810ef18 and files apps/web/src/lib/bl-store-report/{types,compute,render-cli,render-md,fmt,index}.ts + apps/web/scripts/store-report.ts exist on main.
2. store-assessment.ts (main): uses computeStoreAssessmentWithLots, stamps assessment.decision {rawNet,cappedNet,liquidNet,liquidLots,liquidOutlay,liquidGate,inboundPostage}, appends renderDecisionCli output to report_md, writes store-report-<date>.md. The nightly sweep (store-assessment-batch.ts) spawns THIS script as its child, so tonight's runs will stamp decision — confirm the child invocation path.
3. discord-card.ts (main): when a.decision exists the description AND the "Buyable basket" field lead with the LIQUID figure; when absent they fall back to the old headline (old persisted rows must not crash the card). Check batch.ts delta/alert rules still read buyable_net_gbp (unchanged behaviour — note as info if the alert thresholds still key on the UNCAPPED net, that is a known deliberate leftover, severity info).
4. bl-basket.ts (main): after writing its own report it builds buildBasketDecisionReport and writes store-report-<date>.md; enrichmentGap PARTIAL DATA sets meta.dataGapNote; the emit is inside try/catch (non-fatal).
5. Deploy health: GET ${PROD_URL} and ${PROD_URL}/api/health (if 404, any 200-ish page proves the deploy) — the production deployment for the merge commit must be READY (check via: cd repo; gh api "repos/chrishadley1983/hadley-bricks-inventory-management/commits/7810ef18/status" and/or gh api deployments filtered to production, expecting success). This feature is CLI/lib-side so the deploy bar is "prod deploy green and site serves", nothing more.
6. CLAUDE.md contains the "BL Store Review Reporting — Standard Pattern (MANDATORY)" section and .claude/commands/bl-basket.md contains the "Standard decision report" section.
pass=true only if 1-6 hold (3's info-severity leftover does not fail the dimension). Structured findings.`,
  },
];

phase('Validate');
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `validate:${d.key}`, phase: 'Validate', schema: FINDINGS_SCHEMA }),
  (res, d) =>
    res == null
      ? null
      : parallel(
          res.findings
            .filter((f) => f.severity === 'blocker' || f.severity === 'major')
            .map((f) => () =>
              agent(
                `Adversarially verify this finding from the "${res.dimension}" validation of the bl-store-report feature (repo ${REPO}). Try to REFUTE it with direct evidence (read the code, re-run the command). Finding: [${f.severity}] ${f.claim}. Evidence given: ${f.evidence}. Return upheld=true only if the finding survives your attempt to refute it.`,
                { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
              ).then((v) => ({ ...f, verdict: v })),
            ),
        ).then((verified) => ({ ...res, verified: verified.filter(Boolean) })),
);

phase('Synthesize');
const dims = results.filter(Boolean);
const upheldIssues = dims.flatMap((r) =>
  (r.verified ?? []).filter((f) => f.verdict?.upheld).map((f) => ({ dimension: r.dimension, ...f })),
);
const failedDims = dims.filter((r) => !r.pass);
const verdict =
  dims.length < DIMENSIONS.length ? 'INCOMPLETE'
  : upheldIssues.some((f) => f.severity === 'blocker') ? 'FAIL'
  : failedDims.length > 0 || upheldIssues.length > 0 ? 'PASS-WITH-FINDINGS'
  : 'PASS';

log(`Verdict: ${verdict} — ${dims.length}/${DIMENSIONS.length} dimensions, ${upheldIssues.length} upheld major+ findings`);
return {
  verdict,
  dimensions: dims.map((r) => ({ dimension: r.dimension, pass: r.pass, summary: r.summary })),
  upheldIssues,
  allFindings: dims.flatMap((r) => r.findings.map((f) => ({ dimension: r.dimension, ...f }))),
};
