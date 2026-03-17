/**
 * Rerunnable eBay Category Audit Report
 *
 * Checks all active eBay listings for:
 * 1. Item category correctness (complete sets not in Bricks/Parts)
 * 2. Store category completeness (no items in "Other Items" default)
 * 3. Store category correctness (assignment matches rules)
 *
 * Usage: npx tsx apps/web/scripts/ebay-category-audit-report.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { EbayCategoryReviewService } from '../src/lib/ebay/ebay-category-review.service';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: creds } = await (supabase as any)
    .from('ebay_credentials')
    .select('user_id')
    .limit(1)
    .single();

  if (!creds) {
    console.error('No eBay credentials found');
    process.exit(1);
  }

  console.log('Running full eBay category audit...\n');
  const service = new EbayCategoryReviewService(supabase, creds.user_id);
  const report = await service.runFullAudit();

  // =========================================================================
  // Item Category Distribution
  // =========================================================================
  console.log('='.repeat(70));
  console.log('ITEM CATEGORY DISTRIBUTION');
  console.log('='.repeat(70));

  const itemCats = Object.entries(report.summary.itemCategoryDistribution)
    .sort((a, b) => b[1].count - a[1].count);
  for (const [catId, info] of itemCats) {
    const pct = ((info.count / report.totalListings) * 100).toFixed(0);
    console.log(`  ${info.name.padEnd(40)} ${String(info.count).padStart(4)} (${pct}%)  [${catId}]`);
  }

  // =========================================================================
  // Item Category Issues
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log(`ITEM CATEGORY ISSUES (${report.itemCategoryIssues.length})`);
  console.log('='.repeat(70));

  if (report.itemCategoryIssues.length === 0) {
    console.log('  None — all items in correct category');
  } else {
    for (const issue of report.itemCategoryIssues) {
      console.log(`  [${issue.itemId}] ${issue.title.substring(0, 60)}`);
      console.log(`    Current: ${issue.currentCategoryName} (${issue.currentCategoryId})`);
      console.log(`    Should be: ${issue.suggestedCategoryName} (${issue.suggestedCategoryId})`);
      console.log(`    Reason: ${issue.reason}`);
    }
  }

  // =========================================================================
  // Store Category Distribution
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('STORE CATEGORY DISTRIBUTION');
  console.log('='.repeat(70));

  const storeCats = Object.entries(report.summary.storeCategoryDistribution)
    .sort((a, b) => b[1].count - a[1].count);
  for (const [catId, info] of storeCats) {
    const pct = ((info.count / report.totalListings) * 100).toFixed(0);
    console.log(`  ${info.name.padEnd(25)} ${String(info.count).padStart(4)} (${pct}%)  [${catId}]`);
  }

  // =========================================================================
  // Store Category Issues
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log(`STORE CATEGORY ISSUES (${report.storeCategoryIssues.length})`);
  console.log('='.repeat(70));

  if (report.storeCategoryIssues.length === 0) {
    console.log('  None — all items in correct store category');
  } else {
    // Group by change type
    const groups = new Map<string, typeof report.storeCategoryIssues>();
    for (const issue of report.storeCategoryIssues) {
      const key = `${issue.currentStoreCategoryName} → ${issue.suggestedStoreCategoryName}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(issue);
    }

    for (const [change, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  --- ${change} (${items.length}) ---`);
      for (const item of items.slice(0, 10)) {
        console.log(`    [${item.itemId}] ${item.title.substring(0, 60)}`);
      }
      if (items.length > 10) console.log(`    ... and ${items.length - 10} more`);
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total active listings: ${report.totalListings}`);
  console.log(`  Item category issues:  ${report.summary.itemCategoryIssueCount}`);
  console.log(`  Store category issues: ${report.summary.storeCategoryIssueCount}`);

  const clean = report.summary.itemCategoryIssueCount === 0 && report.summary.storeCategoryIssueCount === 0;
  console.log(`\n  Status: ${clean ? 'CLEAN' : 'ISSUES FOUND'}`);
}

main().catch(console.error);
