# Done Criteria: {{FEATURE_NAME}}

**Created:** {{DATE}}
**Author:** Define Done Agent + {{USER_NAME}}
**Status:** {{STATUS}}

---

## Feature Summary

{{FEATURE_SUMMARY}}

**Problem:** {{PROBLEM}}
**User:** {{USER}}
**Trigger:** {{TRIGGER}}
**Outcome:** {{OUTCOME}}

---

## Success Criteria

### Functional

<!--
Each functional criterion defines what the feature must DO.
Format: F1, F2, F3, etc.
Prefer AUTO_VERIFY - only use HUMAN_VERIFY as last resort.
-->

#### F1: {{SHORT_NAME}}
- **Tag:** AUTO_VERIFY | HUMAN_VERIFY | TOOL_VERIFY
- **Criterion:** {{One sentence, binary pass/fail, specific}}
- **Evidence:** {{What proves this is true}}
- **Test:** {{How to check - code snippet, command, or manual step}}

<!-- Add more F2, F3, etc. as needed -->

---

### Error Handling

<!--
Each error criterion defines what happens when things go WRONG.
Format: E1, E2, E3, etc.
-->

#### E1: {{SHORT_NAME}}
- **Tag:** AUTO_VERIFY | HUMAN_VERIFY | TOOL_VERIFY
- **Criterion:** {{One sentence, binary pass/fail, specific}}
- **Evidence:** {{What proves this is true}}
- **Test:** {{How to check}}

<!-- Add more E2, E3, etc. as needed -->

---

### Performance

<!--
Each performance criterion defines speed/scale requirements.
Format: P1, P2, P3, etc.
Always include specific thresholds (e.g., < 500ms, handles 1000 items).
-->

#### P1: {{SHORT_NAME}}
- **Tag:** AUTO_VERIFY | HUMAN_VERIFY | TOOL_VERIFY
- **Criterion:** {{One sentence with specific threshold}}
- **Evidence:** {{Measurement method}}
- **Test:** {{How to measure}}

<!-- Add more P2, P3, etc. as needed -->

---

### UI/UX

<!--
Each UI criterion defines what the user must SEE or EXPERIENCE.
Format: U1, U2, U3, etc.
Try to make verifiable (DOM checks, class names) rather than subjective.
-->

#### U1: {{SHORT_NAME}}
- **Tag:** AUTO_VERIFY | HUMAN_VERIFY | TOOL_VERIFY
- **Criterion:** {{One sentence, binary pass/fail, specific}}
- **Evidence:** {{What proves this is true}}
- **Test:** {{How to check}}

<!-- Add more U2, U3, etc. as needed -->

---

## Out of Scope

<!--
Explicitly list what this feature does NOT include.
This prevents scope creep during build.
-->

- {{Item 1 - explicitly excluded}}
- {{Item 2 - explicitly excluded}}
- {{Item 3 - future enhancement, not MVP}}

---

## Dependencies

<!--
List what must already exist/work for this feature to function.
-->

- {{Dependency 1}}
- {{Dependency 2}}

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | {{short description}} | AUTO_VERIFY | PENDING |
| E1 | {{short description}} | AUTO_VERIFY | PENDING |
| P1 | {{short description}} | AUTO_VERIFY | PENDING |
| U1 | {{short description}} | HUMAN_VERIFY | PENDING |

**Total:** {{N}} criteria ({{X}} AUTO_VERIFY, {{Y}} HUMAN_VERIFY, {{Z}} TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature {{FEATURE_NAME}}`

**Key files likely affected:**
- {{file1.tsx}}
- {{file2.ts}}
- {{new-file.ts}} (new)
