# Build Log: lego-scanner-mvp-spec

## Iteration 1 - Initial Build
**Status:** PARTIAL - Tests written but 20/70 failed due to API mismatches

### Actions
1. Applied Supabase migration via MCP (scanner_sessions, scanner_pieces, scanner-images bucket)
2. Created project scaffold: requirements.txt, .env.example, .gitignore, config.py, models.py
3. Wrote all 8 core modules: camera.py, detector.py, identifier.py, session.py, calibration.py, main.py
4. Created test suite: conftest.py + 6 test files (70 tests)
5. Installed dependencies in Python venv

### Verify Result
- 48 passed, 20 failed, 3 errors
- Failures: test APIs didn't match actual module signatures

---

## Iteration 2 - Fix Tests
**Status:** CONVERGED

### Actions
1. Read all source modules to understand actual APIs
2. Fixed test_camera.py: updated mock strategy for aiohttp session pattern
3. Fixed test_identifier.py: route_by_confidence takes BrickognizeResponse not float, build_identification_result uses `threshold` param
4. Fixed test_cli.py: ScannerConfig defaults (phone_ip="auto", camera_fps=3, calibration_frames=30), parse_cli_args takes args list not base config, build_dashboard takes (session, status, start_time, config)
5. Updated conftest.py fixture defaults

### Verify Result
- **70/70 tests passed** in 2.37s
- All 16 AUTO_VERIFY criteria confirmed
- 3 HUMAN_VERIFY criteria pending (require physical hardware)

### Criteria Verification Summary

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| F1 | Project Structure | PASS | All 10 files exist, requirements.txt + .env.example complete |
| F2 | Camera Module | PASS | 8 unit tests pass (health check, capture, retry, stream) |
| F3 | Detection Module | PASS | 6 tests (MOG2 detection, ROI filter, area filter) |
| F4 | Centroid Tracking | PASS | 5 tests (register, track, deregister, reset) |
| F5 | Best Frame Selection | PASS | 6 tests (sharpness, centredness, selection) |
| F6 | Brickognize API | PASS | 4 tests (success, empty, retry, rate limit) |
| F7 | Confidence Routing | PASS | 5 tests (accepted, flagged, threshold, empty) |
| F8 | Supabase Schema | PASS | SQL verified: both tables + bucket + RLS + indexes |
| F9 | Session Persistence | PASS | 7 tests (start, record, upload, end, abort) |
| F10 | CLI Dashboard | PASS | 3 tests (import, dashboard build, summary display) |
| F11 | CLI Commands | PASS | keyboard_handler with Space/S/R/Q/T implemented |
| F12 | Calibration Flow | PASS | 11 tests (full flow, lighting, contrast, ROI) |
| F13 | Summary & Export | PASS | 4 tests (summary counts, JSON export, CSV export) |
| E1 | Resilience | PASS | Camera retry + Brickognize retry + error handling |
| E2 | Black Piece Warning | PASS | Low-contrast detection with user warning |
| I1 | Supabase Integration | PASS | FK constraints verified (CASCADE, profiles ref) |
| P1 | Throughput | PENDING | Requires physical hardware (HUMAN_VERIFY) |
| H1 | Hardware Integration | PENDING | Requires physical hardware (HUMAN_VERIFY) |
| H2 | Calibration + Camera | PENDING | Requires physical hardware (HUMAN_VERIFY) |
