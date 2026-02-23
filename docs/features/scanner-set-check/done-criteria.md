# Done Criteria: scanner-set-check

**Created:** 2026-02-23
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

Add a "set check" mode to the conveyor belt scanner that loads a LEGO set's expected parts list from the Rebrickable API, then lets the user scan pieces to tick them off. After scanning, displays missing parts and can export a BrickLink wishlist XML file for easy ordering of missing pieces. CLI only — no web UI.

**Problem:** After buying a used LEGO set, Chris needs to verify all pieces are present before listing or building. Currently this is a tedious manual process with printed inventories.
**User:** Chris (business owner)
**Trigger:** `python main.py --check-set <set_number>`
**Outcome:** Real-time checklist of found/missing parts, with BrickLink wishlist export for missing pieces

---

## Success Criteria

### Functional

#### F1: CLI Accepts --check-set Argument
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `python main.py --check-set 75192-1` launches the scanner in set-check mode
- **Evidence:** `argparse` accepts `--check-set` with a set number string; config object has `check_set` field populated
- **Test:** `python main.py --help` shows `--check-set` option; `ScannerConfig` has `check_set: str | None` field

#### F2: Parts List Loaded from Rebrickable API
- **Tag:** AUTO_VERIFY
- **Criterion:** Given a valid set number, the scanner fetches the complete parts list from the Rebrickable API (`/api/v3/lego/sets/{set_num}/parts/`) including part number, color, quantity, and spare flag
- **Evidence:** API response parsed into a list of `SetPart` objects; spare parts are flagged but included separately; pagination handled (all pages fetched if >1000 parts)
- **Test:** Unit test with mocked Rebrickable response returns correct part count and fields; integration test with real API for a known set (e.g., 60370-1) returns expected part count

#### F3: Checklist Tracks Found vs Expected
- **Tag:** AUTO_VERIFY
- **Criterion:** A `SetChecklist` data structure tracks each expected part+color combination with `expected_qty` and `found_qty` fields; scanning a matching piece increments `found_qty`
- **Evidence:** `SetChecklist` class exists with methods: `mark_found(part_id, color_id)` returns `True` if part was expected; `get_missing()` returns parts where `found_qty < expected_qty`; `get_progress()` returns `(found_total, expected_total)`
- **Test:** Unit test: create checklist with 3 parts, mark 2 found, verify progress is (2, 3) and missing returns 1 part

#### F4: Scanned Pieces Matched Against Checklist
- **Tag:** AUTO_VERIFY
- **Criterion:** Each piece identified by Brickognize + color identification is matched against the set checklist by Rebrickable part number + color ID; the match result is displayed in the CLI
- **Evidence:** After identification, the pipeline calls `checklist.mark_found()` with the identified part_id and color_id; CLI shows "Found: 3001 Red (2/4)" or "Extra: 3002 Blue (not in set)"
- **Test:** Integration test: mock a scan result with known part+color, verify checklist updates correctly

#### F5: Real-Time Progress Display
- **Tag:** AUTO_VERIFY
- **Criterion:** The Rich CLI dashboard shows set-check progress: set name, overall progress bar (e.g., "47/189 parts found"), and a scrolling log of matched/extra pieces
- **Evidence:** Dashboard panel exists showing: set number, set name, progress fraction, progress bar; piece log shows last N matches with color-coded status (green=found, yellow=extra)
- **Test:** `SetCheckPanel` class exists and renders with mock data without errors

#### F6: Interactive Check Mode
- **Tag:** AUTO_VERIFY
- **Criterion:** Pressing `C` during scanning pauses the scan and enters "check mode" which displays a formatted table of all missing parts (part number, color, description, needed qty) and a menu: `[R] Resume scanning  [W] Export wishlist  [Q] Quit`
- **Evidence:** Check mode can be entered at any time during scanning; scanning pauses while in check mode; Rich table shows missing parts sorted by category then part number; total progress summary shown (e.g., "47/189 found, 142 missing across 98 unique parts")
- **Test:** Unit test: given a checklist with known missing parts, `format_missing_table()` returns expected Rich Table object

#### F7: BrickLink Wishlist XML Export
- **Tag:** AUTO_VERIFY
- **Criterion:** From check mode (F6), pressing `W` writes a valid BrickLink Mass Upload XML file containing all currently missing parts with correct BrickLink item numbers, color IDs, and quantities; the user can then resume scanning or quit
- **Evidence:** XML file written to `set-check-{set_number}.xml` in current directory; file validates against BrickLink's upload format: `<INVENTORY>` root with `<ITEM>` children containing `<ITEMTYPE>P</ITEMTYPE>`, `<ITEMID>`, `<COLOR>`, `<MINQTY>` tags; after export, returns to check mode menu
- **Test:** Unit test: generate XML from known missing parts list, parse XML and verify structure and values; BrickLink color IDs correctly mapped from Rebrickable IDs

#### F8: Rebrickable-to-BrickLink ID Mapping
- **Tag:** AUTO_VERIFY
- **Criterion:** Part numbers and color IDs are correctly mapped between Rebrickable and BrickLink formats; the mapping handles the known differences (Rebrickable color IDs differ from BrickLink color IDs)
- **Evidence:** A mapping function/table converts Rebrickable color IDs to BrickLink color IDs; Rebrickable part numbers used directly (they match BrickLink for standard parts)
- **Test:** Unit test: map known Rebrickable color IDs (e.g., 0=Black→BL 11, 1=Blue→BL 7, 4=Red→BL 5) and verify correct BrickLink IDs

---

### Error Handling

#### E1: Invalid Set Number
- **Tag:** AUTO_VERIFY
- **Criterion:** If the set number is not found on Rebrickable (404 response), the CLI prints "Set '<number>' not found on Rebrickable. Check the set number and try again." and exits with code 1
- **Evidence:** Error message printed to stderr; exit code is 1; no scan session started
- **Test:** Unit test with mocked 404 response

#### E2: Rebrickable API Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If the Rebrickable API is unreachable or returns a 5xx error, the CLI prints "Failed to fetch parts list from Rebrickable: <error>. Check your API key and network connection." and exits with code 1
- **Evidence:** Error message includes HTTP status or connection error detail
- **Test:** Unit test with mocked network error and 500 response

#### E3: Missing Rebrickable API Key
- **Tag:** AUTO_VERIFY
- **Criterion:** If `REBRICKABLE_API_KEY` environment variable is not set, the CLI prints "REBRICKABLE_API_KEY not set. Get a free key at https://rebrickable.com/api/" and exits with code 1
- **Evidence:** Check happens before any API call; clear instructions for obtaining key
- **Test:** Unit test: config loading without API key raises appropriate error

#### E4: Unrecognised Piece Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If Brickognize cannot identify a piece (low confidence or error), it is logged as "Unrecognised piece (skipped)" in the scan log and does not affect the checklist
- **Evidence:** Unrecognised pieces don't decrement or increment any checklist counts; they appear in the scrolling log with a distinct style (dim/grey)
- **Test:** Unit test: unrecognised piece result does not modify checklist state

---

### Integration

#### I1: Uses Existing Scanner Pipeline
- **Tag:** AUTO_VERIFY
- **Criterion:** Set-check mode reuses the existing camera, detection, identification, and color pipelines — no duplication of core scanning logic
- **Evidence:** `main.py` set-check mode calls the same `camera_loop`, `detection_loop`, `identification_loop` coroutines; only the persistence loop and dashboard are replaced/extended
- **Test:** Code review: set-check mode imports from existing modules, does not duplicate detection/identification logic

#### I2: Color Identification Integrated
- **Tag:** AUTO_VERIFY
- **Criterion:** Each scanned piece undergoes color identification (from `color.py`) to determine the specific part+color combination for checklist matching
- **Evidence:** After Brickognize identifies the part number, `identify_color()` is called with the crop and part_id to get the color; the combination is used for checklist lookup
- **Test:** Integration flow: piece identified as "3001" → color identified as "Red (color_id=5)" → checklist marks "3001 + Red" as found

---

### Performance

#### P1: Parts List Load Time
- **Tag:** AUTO_VERIFY
- **Criterion:** Fetching and parsing the parts list for a set with up to 5000 parts completes in under 10 seconds
- **Evidence:** Timed from API call start to checklist ready; includes pagination if needed
- **Test:** Integration test with large set (e.g., 75192-1 at ~7500 parts including minifig parts) completes under 10 seconds

---

## Out of Scope

- Web UI dashboard for set checking (V2 — later this week)
- Persisting set check state to Supabase between sessions (V2)
- Resuming a previous set check across multiple CLI sessions (V2)
- Automatic set number detection from box/instructions photo
- Price estimation for missing parts
- Direct BrickLink wanted list API upload (manual XML upload only)
- Minifigure sub-part breakdown (treat minifigs as single items matching their fig number)

---

## Dependencies

- Rebrickable API key (free, user must obtain from https://rebrickable.com/api/)
- Existing scanner pipeline (camera, detection, identification, color)
- BrickLink color ID mapping data (derive from existing `data/colors.json` which has Rebrickable IDs)

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | CLI accepts --check-set argument | AUTO_VERIFY | PENDING |
| F2 | Parts list loaded from Rebrickable API | AUTO_VERIFY | PENDING |
| F3 | Checklist tracks found vs expected | AUTO_VERIFY | PENDING |
| F4 | Scanned pieces matched against checklist | AUTO_VERIFY | PENDING |
| F5 | Real-time progress display | AUTO_VERIFY | PENDING |
| F6 | Interactive check mode (C key) | AUTO_VERIFY | PENDING |
| F7 | BrickLink wishlist XML export | AUTO_VERIFY | PENDING |
| F8 | Rebrickable-to-BrickLink ID mapping | AUTO_VERIFY | PENDING |
| E1 | Invalid set number | AUTO_VERIFY | PENDING |
| E2 | Rebrickable API failure | AUTO_VERIFY | PENDING |
| E3 | Missing Rebrickable API key | AUTO_VERIFY | PENDING |
| E4 | Unrecognised piece handling | AUTO_VERIFY | PENDING |
| I1 | Uses existing scanner pipeline | AUTO_VERIFY | PENDING |
| I2 | Color identification integrated | AUTO_VERIFY | PENDING |
| P1 | Parts list load time < 10s | AUTO_VERIFY | PENDING |

**Total:** 15 criteria (15 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature scanner-set-check`

**Key files likely affected:**
- `apps/scanner/main.py` (modified — new mode branch)
- `apps/scanner/config.py` (modified — new CLI arg)
- `apps/scanner/models.py` (modified — new Pydantic models)
- `apps/scanner/rebrickable.py` (new — Rebrickable API client)
- `apps/scanner/set_check.py` (new — SetChecklist, wishlist export, missing parts display)
- `apps/scanner/.env.example` (modified — add REBRICKABLE_API_KEY)
