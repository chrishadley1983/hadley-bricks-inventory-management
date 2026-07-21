export const meta = {
  name: 'validate-one-store-report',
  description: 'Adversarially validate the one-store-report feature: overlap+demand advisory (DUP never removes), ladder-led headline, grounded UK default, Basket inbound postage, sets section, and ONE renderer across every store surface.',
  whenToUse: 'After merging + deploying feature/one-store-report, to confirm the spec Chris validated 2026-07-21 holds on code + live data and no rival renderer survives.',
  phases: [
    { title: 'Validate', detail: 'advisory overlap · ladder · grounded · postage · sets · one-renderer · live · deploy' },
    { title: 'Verify', detail: 'adversarially refute each blocker/major finding' },
    { title: 'Synthesize', detail: 'PASS / PASS-WITH-FINDINGS / FAIL' },
  ],
};

const REPO = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management';
const WEB = `${REPO}/apps/web`;
const PROD_URL = 'https://hadley-bricks-inventory-management.vercel.app';

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['dimension', 'pass', 'summary', 'findings'],
  properties: {
    dimension: { type: 'string' },
    pass: { type: 'boolean' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
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
  type: 'object', additionalProperties: false,
  required: ['upheld', 'reasoning'],
  properties: { upheld: { type: 'boolean' }, reasoning: { type: 'string' } },
};

const DIMENSIONS = [
  {
    key: 'advisory-overlap',
    prompt: `Validate F1/F2 — overlap and the demand cap are ADVISORY, never remove a lot — on main at ${REPO} (working dir ${WEB}, has .env.local).
1. apps/web/src/lib/bl-store-report/compute.ts: the "liquid" filter must NOT exclude DUPLICATE (grep line ~159; it must be \`(r.strQty ?? 0) >= LIQUID_STR_GATE\` with NO \`overlap !== 'DUPLICATE'\` clause). rawNet/cappedNet and every gates[].cappedNet must SUM all buyable rows incl. DUPs.
2. Run: npx vitest run src/lib/bl-store-report — the F1 test ("DUP lots are counted in every headline figure") and F2 test ("demand cap never changes the buyable lot count") must pass.
3. On live data: npx tsx scripts/store-report.ts --slug=thebrickshack_ --json > "%TEMP%/tbs.json"; parse it with a small script and assert: at least one row has overlap==='DUPLICATE' AND that row is present in rows[] (not filtered out); summary.dupLots > 0; and cappedNet computed over ALL rows equals summary.cappedNet + inboundPostage within 1p (i.e. DUP rows are included).
pass=true only if DUPs are provably included in every headline figure and the demand cap changes no lot count. Structured findings with file:line / numeric evidence.`,
  },
  {
    key: 'ladder-headline',
    prompt: `Validate F3 — both renderers lead with the all-band STR ladder, with NO DUP-stripped "honest buy" headline — on main at ${REPO} (working dir ${WEB}).
1. npx tsx scripts/store-report.ts --slug=thebrickshack_ (CLI). The output must contain "BUY LADDER" and the five bands STR≥0, STR≥0.25, STR≥0.5, STR≥0.75, STR≥1, and must NOT contain the strings "the honest buy" or "no DUPs".
2. The written md (tmp/stores/thebrickshack_/store-report-<today>.md) must contain "## Buy ladder" and must NOT contain "## Headline" or a "Liquid (STR≥…, no DUPs" headline row. The gate ladder rows must include an advisory "ex-DUP (info)" line and a "DUP lots (info)" line (labelled as info, not the lead).
3. render-cli.ts / render-md.ts source: confirm no remaining "← the honest buy" or "no DUPs" literals.
pass=true only if the headline is the full ladder and no dup-stripped figure leads. Structured findings.`,
  },
  {
    key: 'grounded-default',
    prompt: `Validate F4 — GROUNDED UK-only pricing is the DEFAULT — on main at ${REPO} (working dir ${WEB}).
1. scripts/store-assessment.ts and scripts/store-report.ts: with NO --pricing-lens flag the resolved input must be ukGroundedOnly === true (read the arg-resolution code; estimate=false, auto=undefined/engine-default, default=true).
2. Live proof: npx tsx scripts/store-report.ts --slug=thebrickshack_ (no lens flag) — the CLI header must print "UK-grounded" (NOT "ESTIMATE lens"), and the coverage line must show world† at or near 0% (world benchmarks are NOT silently used; former world lots resolve to "none"/gaps). Run again WITH --pricing-lens=estimate and confirm the header flips to "ESTIMATE lens" and world% rises — proving grounded is the default, estimate the opt-in.
pass=true only if grounded is the unflagged default and estimate is an explicit opt-in. Structured findings with the two coverage lines as evidence.`,
  },
  {
    key: 'postage-and-sets',
    prompt: `Validate F5 (named postage) and F6 (sets section) on main at ${REPO} (working dir ${WEB}).
1. F5: npx tsx scripts/store-report.ts --slug=thebrickshack_ — both the CLI output and the written md must contain the literal "Basket inbound postage" with the postage value. Confirm each STR band's net deducts the FULL postage once (band net = sum of that band's lot nets − inboundPostage; check the buildGates code + one band numerically from the --json output).
2. F6: the report must render a distinct SETS section (heading "SETS" in CLI, "## Sets" in md) listing FLIP-AMAZON / SELL-BL / PART-OUT / CMFs / SKIP methods, and the parts&minifigs summary.lots must EXCLUDE those set lots (setLotsExcluded > 0 for thebrickshack_, which had 16 set lots).
pass=true only if postage is explicitly named+charged-once and sets render separately from P/M. Structured findings.`,
  },
  {
    key: 'one-renderer',
    prompt: `Validate F7 — every store surface renders through the ONE bl-store-report module; no rival renderer survives — on main at ${REPO}.
1. grep apps/web/scripts/bl-pg-store-scan.ts: there must be NO private buy-table/gate-ladder builder left — its buildReport must call buildBasketDecisionReport + renderDecisionMd (import present) and its md must be the common report + a short "Scan telemetry" note. No leftover per-lot table or STR-gate loop of its own.
2. grep apps/web/scripts/bl-basket.ts: the private renderReport body is gone (it delegates to buildBasketDecisionReport + renderDecisionCli); confirm the orphaned aggregate() helper and unused STR_GATES import were removed.
3. grep apps/web/scripts/store-assessment.ts: it no longer imports or calls renderAssessment; it prints ONLY renderDecisionCli(decision). Confirm the legacy [11]/[12]/[13] terminal sections are gone (this was the "123 vs 167 two gate tables" bug).
4. The React surface (src/components/features/store-assessment/AssessmentView.tsx) must NOT compute its own DUP-stripped buy figure or gate ladder (grep for dup/liquid/gate maths; displaying persisted structured fields is fine).
5. Prove it compiles: cd "${WEB}"; npx tsc --noEmit -p tsconfig.json (zero errors) and npx eslint scripts/bl-pg-store-scan.ts scripts/bl-basket.ts scripts/store-assessment.ts src/lib/bl-store-report (zero errors).
pass=true only if ZERO rival decision-table renderers remain and it all compiles/lints clean. Structured findings with grep evidence.`,
  },
  {
    key: 'live-invariants',
    prompt: `Validate the honesty-ladder maths on LIVE persisted data (working dir ${WEB}, has .env.local). Do NOT eyeball — write a small tsx/node script.
Run: npx tsx scripts/store-report.ts --slug=thebrickshack_ --json > "%TEMP%/tbs.json" and parse the DecisionReport JSON. Assert:
1. summary.rawNet >= summary.cappedNet − 0.5 (cap only reduces).
2. Gate ladder: lots monotonically NON-increasing as gate rises; each gate cappedNetNoDups <= cappedNet + 0.01 (ex-DUP is <= all-in).
3. Every row: cappedQty == null OR cappedQty <= qty; cappedLotNet ≈ netPerUnit × (cappedQty ?? qty) within 2p; benchProvenance in {uk,world,none}; strQty null or >= 0.
4. summary.coverage.ukLots + worldLots + noneLots === coverage.totalLots.
5. rows sorted by cappedLotNet descending.
6. Under grounded default, coverage.worldLots === 0 (world not used).
Repeat on a SECOND store with a stored scrape (query bl_store_scrapes for any other slug, or reuse a tmp/stores listing) to prove it generalises.
pass=true only if 1–6 hold on both stores. Structured findings with the actual numbers.`,
  },
  {
    key: 'wiring-deploy',
    prompt: `Validate wiring + deploy of feature/one-store-report (now merged to main) at ${REPO}.
1. git: origin/main HEAD must contain the two commits (subjects "feat(bl-store-report): one report — overlap+demand advisory…" and "refactor(bl-store): route all store CLIs through the one bl-store-report module"). Files apps/web/src/lib/bl-store-report/{compute,render-cli,render-md,types}.ts and docs/features/one-store-report/done-criteria.md exist on main.
2. discord-card.ts (main): the description + "Buyable basket" field no longer say "no DUPs"; they read the decision fields (which now include DUPs). Old persisted rows without a.decision must still not crash the card (fallback branch present).
3. Deploy health: the production deployment for main's HEAD must be READY. Check: cd "${REPO}"; gh api "repos/chrishadley1983/hadley-bricks-inventory-management/commits/main/status" (expect state success/pending→wait) and GET ${PROD_URL} returns a 200-ish page. This feature is CLI/lib-side, so the bar is "prod deploy green and site serves".
4. Regression suite: cd "${WEB}"; npx vitest run src/lib/bl-store-report src/lib/bl-store-assessment — all pass.
pass=true only if main carries the merge, the card is de-dup-stripped, prod is green, and tests pass. Structured findings.`,
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
                `Adversarially verify this finding from the "${res.dimension}" validation of the one-store-report feature (repo ${REPO}). Try HARD to REFUTE it with direct evidence — read the code, re-run the exact command. A finding that merely restates intended behaviour is refuted. Finding: [${f.severity}] ${f.claim}. Evidence given: ${f.evidence}. Return upheld=true only if the finding survives your refutation attempt.`,
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

return {
  verdict,
  dimensionsRun: dims.length,
  dimensionsExpected: DIMENSIONS.length,
  failedDimensions: failedDims.map((r) => r.dimension),
  upheldIssues,
  perDimension: dims.map((r) => ({ dimension: r.dimension, pass: r.pass, summary: r.summary })),
};
