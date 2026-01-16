#!/usr/bin/env node
/**
 * Batched Test Runner
 *
 * Runs tests in batches to avoid memory issues with large test suites.
 * Each batch runs in a fresh process, results are combined at the end.
 */

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// Configuration
const BATCH_SIZE = 20; // Number of test files per batch (smaller to avoid memory issues)
const TEST_DIR = 'src';
const TEST_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

// Find all test files
function findTestFiles(dir, files = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== 'node_modules' && entry !== '.next') {
      findTestFiles(fullPath, files);
    } else if (stat.isFile() && TEST_PATTERN.test(entry)) {
      files.push(relative(process.cwd(), fullPath).replace(/\\/g, '/'));
    }
  }
  return files;
}

// Run a batch of tests
function runBatch(files, batchNum, totalBatches) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH ${batchNum}/${totalBatches} (${files.length} files)`);
  console.log(`${'='.repeat(60)}\n`);

  const fileList = files.join(' ');
  const cmd = `npx vitest run ${fileList}`;

  try {
    execSync(cmd, {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer
    });
    return { batchNum, files: files.length, success: true };
  } catch (error) {
    // Check if tests ran but some failed (exit code 1) vs crash
    if (error.status === 1) {
      // Tests ran but some failed
      return { batchNum, files: files.length, success: false, testsFailed: true };
    }
    // Process crashed
    return { batchNum, files: files.length, success: false, crashed: true };
  }
}

// Main
function main() {
  console.log('Finding test files...');
  const testFiles = findTestFiles(TEST_DIR);
  console.log(`Found ${testFiles.length} test files\n`);

  // Split into batches
  const batches = [];
  for (let i = 0; i < testFiles.length; i += BATCH_SIZE) {
    batches.push(testFiles.slice(i, i + BATCH_SIZE));
  }
  console.log(`Split into ${batches.length} batches of ~${BATCH_SIZE} files each`);

  // Run batches sequentially
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const result = runBatch(batches[i], i + 1, batches.length);
    results.push(result);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(60)}`);

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(r => {
    let status = r.success ? '✓ PASSED' : '✗ FAILED';
    if (r.crashed) status += ' (crashed)';
    if (r.testsFailed) status += ' (test failures)';
    console.log(`  Batch ${r.batchNum}: ${status} (${r.files} files)`);
  });

  console.log(`\nTotal: ${passed}/${batches.length} batches passed`);
  console.log(`Time: ${totalTime}s`);
  console.log(`Test files: ${testFiles.length}`);

  // Exit with error if any batch failed
  if (failed > 0) {
    console.log(`\n⚠️  ${failed} batch(es) failed`);
    process.exit(1);
  } else {
    console.log('\n✅ All batches passed!');
    process.exit(0);
  }
}

main();
