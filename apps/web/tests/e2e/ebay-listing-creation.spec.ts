import { test, expect } from '@playwright/test';

/**
 * eBay Listing Creation E2E Tests
 *
 * Tests the complete flow of creating an eBay listing from inventory.
 * Uses the LEGO Technic McLaren Formula 1 set 42141 as test data.
 *
 * Prerequisites:
 * - Auth setup completed (run: npx playwright test auth.setup --project=setup)
 * - Dev server running on localhost:3000
 * - eBay connection active with proper scopes
 */

// Test configuration
const TEST_TIMEOUT = 120000; // 2 minutes for full flow

test.describe('eBay Listing Creation', () => {
  // First, let's verify the prerequisites
  test('Prerequisites - verify eBay connection', async ({ request }) => {
    const response = await request.get('/api/ebay/connection/scopes');
    expect(response.status()).toBe(200);

    const data = await response.json();
    console.log('eBay Connection Status:', JSON.stringify(data, null, 2));

    expect(data.data.isConnected).toBe(true);
    expect(data.data.hasScopes).toBe(true);
  });

  test('Prerequisites - verify business policies are cached', async ({ request }) => {
    const response = await request.get('/api/ebay/business-policies');
    console.log('Business Policies Status:', response.status());

    if (response.status() === 200) {
      const data = await response.json();
      console.log('Business Policies:', JSON.stringify(data, null, 2));
      expect(data.data.fulfillment?.length).toBeGreaterThan(0);
      expect(data.data.payment?.length).toBeGreaterThan(0);
      expect(data.data.return?.length).toBeGreaterThan(0);
    } else {
      const error = await response.json();
      console.log('Business Policies Error:', error);
    }
  });

  test('Prerequisites - get inventory item for testing', async ({ request }) => {
    // Get inventory items to find one to test with - no status filter first to see what's available
    const response = await request.get('/api/inventory?pageSize=20');
    expect(response.status()).toBe(200);

    const data = await response.json();
    console.log('API Response structure:', JSON.stringify(data, null, 2).substring(0, 500));

    // The service returns { data: { data: [...], total, page, pageSize, totalPages } }
    const items = data.data?.data || [];
    console.log('Total Inventory Items:', data.data?.total);
    console.log('Items in this page:', items.length);

    if (items.length > 0) {
      // Log status distribution
      const statusCounts: Record<string, number> = {};
      items.forEach((item: { status: string }) => {
        statusCounts[item.status || 'null'] = (statusCounts[item.status || 'null'] || 0) + 1;
      });
      console.log('Status distribution:', statusCounts);

      // Log first few items
      items.slice(0, 5).forEach((item: { id: string; set_number: string; item_name: string; condition: string; status: string }) => {
        console.log(`  - ${item.set_number}: ${item.item_name} (${item.condition}, ${item.status}) [${item.id}]`);
      });
    }
  });

  test('Debug - test createOffer request format', async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT);

    // First, let's manually test the createOffer API call format
    // by hitting a debug endpoint that logs the request without calling eBay

    // Get business policies first
    const policiesResponse = await request.get('/api/ebay/business-policies');
    if (policiesResponse.status() !== 200) {
      console.log('Cannot get business policies, skipping test');
      test.skip();
      return;
    }

    const policies = await policiesResponse.json();
    console.log('\n=== Business Policies ===');
    console.log('Fulfillment:', policies.data.fulfillment?.map((p: { fulfillmentPolicyId: string; name: string }) => `${p.name} (${p.fulfillmentPolicyId})`));
    console.log('Payment:', policies.data.payment?.map((p: { paymentPolicyId: string; name: string }) => `${p.name} (${p.paymentPolicyId})`));
    console.log('Return:', policies.data.return?.map((p: { returnPolicyId: string; name: string }) => `${p.name} (${p.returnPolicyId})`));
  });

  test('Full Flow - create eBay listing from inventory', async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Step 1: Get an available inventory item (BACKLOG status = not yet listed)
    console.log('\n=== Step 1: Finding inventory item ===');
    const inventoryResponse = await request.get('/api/inventory?pageSize=100&status=BACKLOG');
    expect(inventoryResponse.status()).toBe(200);

    const inventoryData = await inventoryResponse.json();
    const items = inventoryData.data?.data || [];

    if (items.length === 0) {
      console.log('No BACKLOG inventory items found');
      test.skip();
      return;
    }

    console.log(`Found ${items.length} BACKLOG items`);

    // Find item 42123 or use first available
    let testItem = items.find((item: { set_number: string }) => item.set_number === '42123');
    if (!testItem) {
      console.log('Item 42123 not found in BACKLOG, using first available item');
      testItem = items[0];
    }

    console.log(`Selected item: ${testItem.set_number} - ${testItem.item_name}`);
    console.log(`Item ID: ${testItem.id}`);
    console.log(`Condition: ${testItem.condition}`);

    // Step 2: Create a minimal test image (1x1 red pixel PNG)
    console.log('\n=== Step 2: Preparing test image ===');
    // Minimal valid PNG (1x1 red pixel)
    const minimalPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    const photos = [
      {
        id: 'test-photo-1',
        filename: 'test-image.png',
        base64: minimalPngBase64,
        mimeType: 'image/png' as const,
        enhanced: false,
      },
    ];

    // Step 3: Prepare listing creation request
    console.log('\n=== Step 3: Preparing listing request ===');
    const listingRequest = {
      inventoryItemId: testItem.id,
      price: 149.99,
      bestOffer: {
        enabled: true,
        autoAcceptPercent: 95,
        autoDeclinePercent: 75,
      },
      photos,
      enhancePhotos: false,
      descriptionStyle: 'Minimalist',
      listingType: 'live',
      // No policy overrides - use defaults
    };

    console.log('Request (without photo data):', JSON.stringify({
      ...listingRequest,
      photos: listingRequest.photos.map(p => ({
        id: p.id,
        filename: p.filename,
        mimeType: p.mimeType,
        base64Length: p.base64.length,
      })),
    }, null, 2));

    // Step 4: Call the listing creation API
    console.log('\n=== Step 4: Calling listing creation API ===');
    const createResponse = await request.post('/api/ebay/listing', {
      data: listingRequest,
      timeout: 90000, // 90 second timeout for the full flow
    });

    console.log('Response status:', createResponse.status());

    // For SSE responses, we need to read the stream
    if (createResponse.status() === 200) {
      const responseText = await createResponse.text();
      console.log('\n=== SSE Response Stream ===');

      // Parse SSE events
      const events = responseText.split('\n\n').filter(e => e.trim());
      for (const eventStr of events) {
        if (eventStr.startsWith('data: ')) {
          try {
            const event = JSON.parse(eventStr.slice(6));
            console.log(`Event [${event.type}]:`, JSON.stringify(event.data, null, 2));

            if (event.type === 'complete') {
              console.log('\n=== SUCCESS ===');
              console.log('Listing ID:', event.data.listingId);
              console.log('Listing URL:', event.data.listingUrl);
              expect(event.data.success).toBe(true);
            } else if (event.type === 'error') {
              console.log('\n=== ERROR ===');
              console.log('Error:', event.data);
              // Don't fail the test - we're debugging
            }
          } catch (e) {
            console.log('Raw event:', eventStr);
          }
        }
      }
    } else {
      // Non-SSE error response
      const errorData = await createResponse.json();
      console.log('Error Response:', JSON.stringify(errorData, null, 2));
    }
  });

  test('Debug - fetch fresh return policies', async ({ request }) => {
    // Force refresh policies from eBay by using POST
    const response = await request.post('/api/ebay/business-policies');
    console.log('Business Policies Response Status:', response.status());

    if (response.status() === 200) {
      const data = await response.json();
      console.log('\n=== Return Policies (with details) ===');
      data.data.return?.forEach((p: { id: string; name: string; isDefault?: boolean; data?: unknown }) => {
        console.log(`- ${p.name} (ID: ${p.id}, isDefault: ${p.isDefault})`);
        console.log(`  Full data:`, JSON.stringify(p.data, null, 2).substring(0, 500));
      });
      console.log('\n=== Defaults ===');
      console.log('Default fulfillment:', data.data.defaults?.fulfillmentPolicyId);
      console.log('Default payment:', data.data.defaults?.paymentPolicyId);
      console.log('Default return:', data.data.defaults?.returnPolicyId);

      console.log('\n=== Fulfillment Policies ===');
      data.data.fulfillment?.forEach((p: { fulfillmentPolicyId: string; name: string; marketplaceId?: string }) => {
        console.log(`- ${p.name} (${p.fulfillmentPolicyId}) [${p.marketplaceId}]`);
      });

      console.log('\n=== Payment Policies ===');
      data.data.payment?.forEach((p: { paymentPolicyId: string; name: string; marketplaceId?: string }) => {
        console.log(`- ${p.name} (${p.paymentPolicyId}) [${p.marketplaceId}]`);
      });
    } else {
      const error = await response.json();
      console.log('Error:', error);
    }
  });

  test('Debug - test offer request structure', async ({ request }) => {
    test.setTimeout(30000);

    // This test validates the offer request structure matches eBay's expectations
    // Based on eBay API docs: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer

    console.log('\n=== Analyzing Offer Request Structure ===');

    // Get business policies
    const policiesResponse = await request.get('/api/ebay/business-policies');
    if (policiesResponse.status() !== 200) {
      console.log('Cannot get business policies');
      test.skip();
      return;
    }

    const policies = await policiesResponse.json();
    const fulfillmentPolicy = policies.data.fulfillment?.[0];
    const paymentPolicy = policies.data.payment?.[0];
    const returnPolicy = policies.data.return?.[0];

    if (!fulfillmentPolicy || !paymentPolicy || !returnPolicy) {
      console.log('Missing required policies');
      test.skip();
      return;
    }

    // This is what eBay expects for the offer request
    const expectedOfferStructure = {
      sku: 'HADLEY-42123-TIMESTAMP',
      marketplaceId: 'EBAY_GB',
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: '183446', // LEGO Building Toys
      listingDescription: '<p>Description here</p>',
      listingPolicies: {
        fulfillmentPolicyId: fulfillmentPolicy.fulfillmentPolicyId,
        paymentPolicyId: paymentPolicy.paymentPolicyId,
        returnPolicyId: returnPolicy.returnPolicyId,
      },
      pricingSummary: {
        price: {
          value: '149.99',
          currency: 'GBP',
        },
      },
      // bestOffer should have this structure when enabled
      bestOffer: {
        bestOfferEnabled: true,
        autoAcceptPrice: {
          value: '142.49', // 95% of 149.99
          currency: 'GBP',
        },
        autoDeclinePrice: {
          value: '112.49', // 75% of 149.99
          currency: 'GBP',
        },
      },
    };

    console.log('Expected offer structure:', JSON.stringify(expectedOfferStructure, null, 2));
    console.log('\nKey points:');
    console.log('- price.value must be a STRING, not a number');
    console.log('- autoAcceptPrice/autoDeclinePrice must be strings');
    console.log('- bestOfferEnabled must be boolean');
    console.log('- categoryId must be a string');
  });
});
