/**
 * Direct test of TerapeakScraper using persistent browser profile.
 */

import { TerapeakScraper } from '../src/lib/minifig-sync/terapeak-scraper';

async function main() {
  const scraper = new TerapeakScraper();

  console.log('Testing Terapeak scrape for sw1002 (Clone Scout Trooper)...');
  try {
    const result = await scraper.research(
      'Clone Scout Trooper, 41st Elite Corps',
      'sw1002',
    );
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error type:', (err as Error).constructor.name);
    console.error('Error message:', (err as Error).message);
  }
}

main();
