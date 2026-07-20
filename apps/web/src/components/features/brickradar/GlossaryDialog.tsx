'use client';

import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { MiniMarkdown } from './markdown';

/**
 * Static glossary content — the five acquisition lanes and the key concepts a
 * reader needs to make sense of the rest of the dashboard (STR, tiers, L1/L3,
 * POV, freshness, parse version/histogram, block-rate). Written as markdown and
 * rendered through the app's existing MiniMarkdown renderer (same one used for
 * report_md elsewhere on this page) rather than adding a second bespoke JSX
 * layout — one less thing to keep visually consistent.
 */
const GLOSSARY_MD = `
## The five acquisition lanes

How we actually get BrickLink's price-guide data — five separate "lanes", each a different cost/risk/detail trade-off:

- **Lane A — official BrickLink store API.** Official, instant, quota-limited (~1,500 usable calls/day). Used for live UK price checks at buy time.
- **Lane B — BrickStore batch harvest.** A fortnightly bulk refresh — the fastest way to refresh tens of thousands of tuples in one go. A ~15-minute manual ritual.
- **Lane C — anonymous curl.** Fetches BrickLink's summary page with no login. Free, zero account risk. Fills gaps and covers new releases.
- **Lane D — browser catalogPG scrape.** A logged-in Chrome session scraping full price-guide pages. The richest data we get — UK detail, monthly velocity, and price histograms. This is the nightly workhorse.
- **Lane E — catalog downloads.** Monthly official files that define the universe of parts/figs/sets that exist.

## Key concepts

- **STR (Sell-Through Rate)** = sold lots ÷ stock lots. Above 1 sells faster than it's stocked; below 0.5 is oversupplied/slow.
- **Tiers — Active vs Tail.** Active = the top ~60k tuples by 6-month sold value, refreshed on a 60-day UK-grade cycle (28 days for new-for-the-year items). Tail = everything else, on a 90-day UK cycle.
- **L1 vs L3.** L1 = worldwide summary (broad, cheap to hold — every tuple gets one). L3 = UK-specific detail (precise — this is what buy decisions actually use).
- **POV (Part-Out Value).** What a sealed set is worth broken into its individual parts.
- **Coverage.** The % of active-tier tuples with a real UK scrape (or confirmed no-data) inside the 60-day cycle — from the pg_coverage_report view, never the queue's due-dates.
- **Parse version / histogram.** Rows scraped before the price-histogram feature (parse v2) show UK averages but no price distribution. v3+ rows (scraped from 8 Jul 2026 on) include the "STR at my price" sold-price histogram.
- **Block-rate / first-block.** The tripwire metric that tells us to throttle a lane down before a real ban — how many requests a scrape session survives before BrickLink challenges it. Higher is safer.
`.trim();

export function GlossaryDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <BookOpen className="h-4 w-4" />
          How this works
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            BrickRadar glossary
          </DialogTitle>
          <DialogDescription>
            How the data gets here, and what the numbers on this page mean.
          </DialogDescription>
        </DialogHeader>
        <MiniMarkdown markdown={GLOSSARY_MD} />
      </DialogContent>
    </Dialog>
  );
}
