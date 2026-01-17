# Verification Report: {{FEATURE_NAME}}

**Generated:** {{TIMESTAMP}}
**Iteration:** {{ITERATION}} of {{MAX_ITERATIONS}}
**Verdict:** {{VERDICT}}

---

## Summary

| Status | Count | Criteria |
|--------|-------|----------|
| ✅ PASS | {{PASS_COUNT}} | {{PASS_IDS}} |
| ❌ FAIL | {{FAIL_COUNT}} | {{FAIL_IDS}} |
| 👤 PENDING | {{PENDING_COUNT}} | {{PENDING_IDS}} |
| ⏭️ SKIP | {{SKIP_COUNT}} | {{SKIP_IDS}} |

---

## Criteria Results

### Passing ✅

{{#PASSING_CRITERIA}}
#### {{ID}}: {{NAME}}
- **Status:** PASS
- **Test performed:** {{TEST_DESCRIPTION}}
- **Evidence:** {{EVIDENCE_DESCRIPTION}}
- **Proof:** {{EVIDENCE_PATH}}
{{/PASSING_CRITERIA}}

---

### Failing ❌

{{#FAILING_CRITERIA}}
#### {{ID}}: {{NAME}}
- **Status:** FAIL
- **Test performed:** {{TEST_DESCRIPTION}}
- **Expected:** {{EXPECTED}}
- **Actual:** {{ACTUAL}}
- **Gap:** {{GAP}}
- **Location:** {{FILE}}:{{LINE}}
- **Suggested Fix:** {{SUGGESTED_FIX}}
- **Confidence:** {{CONFIDENCE}}
{{/FAILING_CRITERIA}}

---

### Pending Human Verification 👤

{{#HUMAN_VERIFY_CRITERIA}}
#### {{ID}}: {{NAME}}
- **Status:** PENDING_HUMAN
- **Screenshot:** {{SCREENSHOT_PATH}}
- **Question:** {{VERIFICATION_QUESTION}}
{{/HUMAN_VERIFY_CRITERIA}}

---

## Failure Summary (for Build Agent)

{{#HAS_FAILURES}}
### Required Changes for Next Iteration

{{#FAILURES}}
{{PRIORITY}}. **{{ID}}: {{SHORT_DESCRIPTION}}**
   - File: {{FILE}}:{{LINE}}
   - Change: {{SUGGESTED_FIX}}
   - Estimated lines: {{ESTIMATED_LINES}}
{{/FAILURES}}

### Failure Signature
`{{FAILURE_SIGNATURE}}`
{{/HAS_FAILURES}}

{{^HAS_FAILURES}}
No failures - all AUTO_VERIFY criteria pass.
{{/HAS_FAILURES}}

---

## Next Action

{{#IS_CONVERGED}}
- ✅ CONVERGED → Human reviews PENDING criteria, then proceeds to test/merge
{{/IS_CONVERGED}}

{{#IS_FAILED}}
- ❌ FAILED → Build Feature Agent iterates with failure context
{{/IS_FAILED}}

{{#IS_BLOCKED}}
- ⛔ BLOCKED → Fix blocker: {{BLOCK_REASON}}
- Suggestion: {{BLOCK_SUGGESTION}}
{{/IS_BLOCKED}}

---

## Evidence Files

{{#EVIDENCE_FILES}}
- [{{CRITERION_ID}}] {{FILENAME}} - {{DESCRIPTION}}
{{/EVIDENCE_FILES}}

---

## Verification Duration

- Started: {{START_TIME}}
- Completed: {{END_TIME}}
- Duration: {{DURATION_MS}}ms
