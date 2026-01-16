/**
 * Debug script to check raw eBay API response
 * Run with: npx ts-node --esm scripts/debug-ebay-api.ts
 */

import { createClient } from '@supabase/supabase-js';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const EBAY_TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const EBAY_API_COMPATIBILITY_LEVEL = '1349';

async function getAccessToken(): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get the first user's eBay credentials
  const { data: creds } = await supabase
    .from('platform_credentials')
    .select('*')
    .eq('platform', 'ebay')
    .limit(1)
    .single();

  if (!creds) {
    console.error('No eBay credentials found');
    return null;
  }

  return creds.access_token;
}

async function fetchRawXml(accessToken: string): Promise<string> {
  const xmlBuilder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    format: true,
    suppressEmptyNode: true,
  });

  const now = new Date();
  const endTime = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);

  const request = {
    GetSellerListRequest: {
      '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
      DetailLevel: 'ReturnAll',
      EndTimeFrom: now.toISOString(),
      EndTimeTo: endTime.toISOString(),
      IncludeVariations: 'true',
      GranularityLevel: 'Fine',
      Pagination: {
        EntriesPerPage: '10',
        PageNumber: '1',
      },
    },
  };

  const requestXml = '<?xml version="1.0" encoding="utf-8"?>\n' + xmlBuilder.build(request);

  const response = await fetch(EBAY_TRADING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-CALL-NAME': 'GetSellerList',
      'X-EBAY-API-SITEID': '3',
      'X-EBAY-API-COMPATIBILITY-LEVEL': EBAY_API_COMPATIBILITY_LEVEL,
      'X-EBAY-API-IAF-TOKEN': accessToken,
    },
    body: requestXml,
  });

  return response.text();
}

async function main() {
  console.log('Getting eBay access token...');
  const accessToken = await getAccessToken();

  if (!accessToken) {
    console.error('Failed to get access token');
    process.exit(1);
  }

  console.log('Fetching eBay listings...');
  const rawXml = await fetchRawXml(accessToken);

  // Save raw XML
  const outputPath = path.join(__dirname, '../debug-ebay-response.xml');
  fs.writeFileSync(outputPath, rawXml);
  console.log(`Raw XML saved to: ${outputPath}`);

  // Parse and extract item with known watchers
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
  });

  const parsed = xmlParser.parse(rawXml);
  const items = parsed.GetSellerListResponse?.ItemArray?.Item;

  if (items) {
    const itemArray = Array.isArray(items) ? items : [items];
    console.log(`\nFound ${itemArray.length} items\n`);

    // Find Dobby's Release item
    const dobbyItem = itemArray.find((i: any) => i.ItemID === '177476194025');
    if (dobbyItem) {
      console.log('Dobby\'s Release item (177476194025):');
      console.log('  WatchCount:', dobbyItem.WatchCount);
      console.log('  HitCount:', dobbyItem.HitCount);
      console.log('  PictureDetails:', JSON.stringify(dobbyItem.PictureDetails, null, 2));
      console.log('  All keys:', Object.keys(dobbyItem));
    } else {
      console.log('Dobby\'s Release item not found in first page');
    }

    // Show first item's structure
    console.log('\nFirst item structure:');
    console.log('  ItemID:', itemArray[0].ItemID);
    console.log('  WatchCount:', itemArray[0].WatchCount);
    console.log('  HitCount:', itemArray[0].HitCount);
    console.log('  PictureDetails:', JSON.stringify(itemArray[0].PictureDetails, null, 2));
  }
}

main().catch(console.error);
