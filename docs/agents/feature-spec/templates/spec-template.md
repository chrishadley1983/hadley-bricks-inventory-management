# Feature Specification: {{FEATURE_NAME}}

**Generated:** {{TIMESTAMP}}
**Based on:** done-criteria.md ({{CRITERIA_HASH}})
**Status:** {{STATUS}}

---

## 1. Summary

{{FEATURE_SUMMARY}}

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
{{#CRITERIA}}
| {{ID}}: {{NAME}} | {{APPROACH}} |
{{/CRITERIA}}

---

## 3. Architecture

### 3.1 Integration Points

{{#INTEGRATION_POINTS}}
**{{AREA}}:**
- Location: `{{LOCATION}}`
- Current state: {{CURRENT_STATE}}
- Integration: {{INTEGRATION_DESCRIPTION}}
- Risk: {{RISK_LEVEL}}
{{/INTEGRATION_POINTS}}

### 3.2 Diagram

```
{{ARCHITECTURE_DIAGRAM}}
```

### 3.3 Technology Decisions

{{#TECH_DECISIONS}}
**{{DECISION_NAME}}:**
- Options: {{OPTIONS}}
- Decision: {{CHOSEN_OPTION}}
- Rationale: {{RATIONALE}}
{{/TECH_DECISIONS}}

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
{{#NEW_FILES}}
| `{{PATH}}` | {{PURPOSE}} | {{LINES}} |
{{/NEW_FILES}}

### 4.2 Modified Files

| File | Changes | Est. Lines |
|------|---------|------------|
{{#MODIFIED_FILES}}
| `{{PATH}}` | {{CHANGES}} | {{LINES}} |
{{/MODIFIED_FILES}}

### 4.3 No Changes Needed

{{#NO_CHANGE_FILES}}
- `{{PATH}}` - {{REASON}}
{{/NO_CHANGE_FILES}}

---

## 5. Implementation Details

### 5.1 Components

{{#COMPONENTS}}
#### {{COMPONENT_NAME}}

**Location:** `{{LOCATION}}`
**Props:** {{PROPS}}
**Behavior:** {{BEHAVIOR}}

```tsx
{{CODE_PATTERN}}
```
{{/COMPONENTS}}

### 5.2 API Endpoints

{{#API_ENDPOINTS}}
#### {{METHOD}} {{PATH}}

**Purpose:** {{PURPOSE}}
**Authentication:** {{AUTH}}

**Request:** {{REQUEST_SPEC}}

**Response (Success):** {{SUCCESS_RESPONSE}}

**Response (Error):** {{ERROR_RESPONSE}}
{{/API_ENDPOINTS}}

### 5.3 Data Flow

{{DATA_FLOW_DESCRIPTION}}

---

## 6. Build Order

{{#BUILD_STEPS}}
### Step {{NUMBER}}: {{TITLE}}

{{DESCRIPTION}}

**Files:** {{FILES}}
**Criteria addressed:** {{CRITERIA_IDS}}
{{/BUILD_STEPS}}

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Probability | Criteria | Mitigation | Fallback |
|------|-------------|----------|------------|----------|
{{#RISKS}}
| {{DESCRIPTION}} | {{PROBABILITY}} | {{CRITERIA}} | {{MITIGATION}} | {{FALLBACK}} |
{{/RISKS}}

### 7.2 Scope Risks

{{SCOPE_RISKS}}

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
{{#FEASIBILITY}}
| {{ID}}: {{NAME}} | {{FEASIBLE}} | {{CONFIDENCE}} | {{NOTES}} |
{{/FEASIBILITY}}

**Overall:** {{OVERALL_FEASIBILITY}}

{{#HAS_ISSUES}}
### Feasibility Issues

{{#ISSUES}}
#### Issue: {{ID}} is not feasible as written

**Criterion:** {{CRITERION_TEXT}}
**Problem:** {{PROBLEM}}
**Options:**
{{OPTIONS}}
**Recommendation:** {{RECOMMENDATION}}
{{/ISSUES}}
{{/HAS_ISSUES}}

---

## 9. Notes for Build Agent

{{#NOTES}}
- {{NOTE}}
{{/NOTES}}

---

## 10. Handoff

**Status:** {{STATUS}}

{{#IS_READY}}
Ready for: `/build-feature {{FEATURE_NAME}}`
{{/IS_READY}}

{{#NEEDS_UPDATE}}
**Action required:** Update done-criteria.md, then re-run `/feature-spec {{FEATURE_NAME}}`
{{/NEEDS_UPDATE}}

{{#BLOCKED_ON_DATABASE}}
**Action required:** Run database migration first, then `/feature-spec {{FEATURE_NAME}} --validate`
{{/BLOCKED_ON_DATABASE}}
