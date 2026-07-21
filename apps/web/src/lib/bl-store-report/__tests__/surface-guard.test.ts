/**
 * Store-analysis surface guards (2026-07-21 footgun sweep, PR follow-up to one-store-report).
 *
 * These fail the BUILD if a known footgun returns — the point Chris made: the truncated-
 * inventory mistake shouldn't have been *possible*. Each guard pins a specific hazard shut.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WEB = path.resolve(__dirname, '../../../..'); // .../apps/web
const read = (rel: string) => fs.readFileSync(path.join(WEB, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(WEB, rel));

describe('store-analysis surface guards', () => {
  it('bl-pg-store-scan does NOT truncate inventory by default (the 5k-part cap that misled a gap analysis)', () => {
    const src = read('scripts/bl-pg-store-scan.ts');
    expect(src, 'the old 50-page/5,000-part default must not return').not.toMatch(/argv\['max-pages'\]\s*\?\?\s*'50'/);
    expect(src, 'default must be the no-truncation 500-page cap').toMatch(/argv\['max-pages'\]\s*\?\?\s*'500'/);
  });

  it('the legacy renderAssessment / bl-store-assessment format.ts renderer stays deleted', () => {
    expect(exists('src/lib/bl-store-assessment/format.ts'), 'format.ts (the [11]/[12]/[13] rival renderer) must not reappear').toBe(false);
  });

  it('the sanctioned CLIs render through the common bl-store-report module, not a private table', () => {
    for (const f of ['scripts/store-assessment.ts', 'scripts/store-report.ts', 'scripts/bl-basket.ts', 'scripts/bl-pg-store-scan.ts']) {
      expect(read(f), `${f} must import the common bl-store-report module`).toMatch(/bl-store-report/);
    }
    // store-assessment must NOT re-introduce the legacy renderer call.
    expect(read('scripts/store-assessment.ts')).not.toMatch(/renderAssessment\(/);
  });
});
