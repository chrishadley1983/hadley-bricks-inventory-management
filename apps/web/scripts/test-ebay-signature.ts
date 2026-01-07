/**
 * Test script for eBay Finances API signature
 * Run with: npx tsx scripts/test-ebay-signature.ts
 */

import crypto from 'crypto';
import { generateDigestHeader } from 'digital-signature-nodejs-sdk';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface EbaySigningKeys {
  signingKeyId: string;
  privateKey: string;
  publicKey: string;
  jwe: string;
  expiresAt: string;
}

interface SignedRequestHeaders {
  'x-ebay-signature-key': string;
  'Content-Digest'?: string;
  Signature: string;
  'Signature-Input': string;
}

/**
 * Format ED25519 private key to proper PEM format
 */
function formatPrivateKey(privateKey: string): string {
  let formatted = privateKey.replace(/\\n/g, '\n');

  if (formatted.includes('-----BEGIN')) {
    formatted = formatted.replace(/\r/g, '');
    const match = formatted.match(/-----BEGIN [A-Z ]+-----\s*([\s\S]*?)\s*-----END [A-Z ]+-----/);
    if (match) {
      const base64Content = match[1].replace(/\s/g, '');
      const lines: string[] = [];
      for (let i = 0; i < base64Content.length; i += 64) {
        lines.push(base64Content.substring(i, i + 64));
      }
      formatted = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
    }
    return formatted;
  }

  const cleanBase64 = privateKey.replace(/\s/g, '');
  const lines: string[] = [];
  for (let i = 0; i < cleanBase64.length; i += 64) {
    lines.push(cleanBase64.substring(i, i + 64));
  }
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

/**
 * Generate signature base string
 * Based on working example from StackOverflow - the key is:
 * 1. Each line ends with \n EXCEPT the last line (@signature-params)
 * 2. The signature-params value does NOT have the "sig1=" prefix in the base string
 */
function generateSignatureBase(
  signatureParams: string[],
  signatureComponents: { method: string; path: string; authority: string },
  headers: Record<string, string>,
  timestamp: number
): string {
  // Build signature-params value first (without sig1= prefix for the base string)
  let signatureParamsValue = '(';
  for (let i = 0; i < signatureParams.length; i++) {
    signatureParamsValue += '"' + signatureParams[i] + '"';
    if (i < signatureParams.length - 1) {
      signatureParamsValue += ' ';
    }
  }
  signatureParamsValue += ');created=' + timestamp.toString();

  // Build the base string - each line ends with \n EXCEPT the last one
  const lines: string[] = [];

  for (const param of signatureParams) {
    let value: string;

    if (param.startsWith('@')) {
      switch (param.toLowerCase()) {
        case '@method':
          value = signatureComponents.method;
          break;
        case '@path':
          value = signatureComponents.path;
          break;
        case '@authority':
          value = signatureComponents.authority;
          break;
        default:
          throw new Error(`Unknown derived component: ${param}`);
      }
    } else {
      const headerValue = headers[param];
      if (!headerValue) {
        throw new Error(`Header ${param} not found`);
      }
      value = headerValue;
    }

    lines.push(`"${param.toLowerCase()}": ${value}`);
  }

  // Add signature-params as the last line (no trailing newline)
  lines.push(`"@signature-params": ${signatureParamsValue}`);

  // Join with \n - this means no trailing newline after the last line
  return lines.join('\n');
}

/**
 * Sign a request
 */
function signRequest(
  keys: EbaySigningKeys,
  method: string,
  url: string,
  body?: string
): SignedRequestHeaders {
  const parsedUrl = new URL(url);
  const timestamp = Math.floor(Date.now() / 1000);

  const headers: Record<string, string> = {
    'x-ebay-signature-key': keys.jwe,
  };

  const signatureParams = ['x-ebay-signature-key', '@method', '@path', '@authority'];

  if (body) {
    const contentDigest = generateDigestHeader(Buffer.from(body, 'utf-8'), 'sha256');
    headers['content-digest'] = contentDigest;
    signatureParams.unshift('content-digest');
  }

  const signatureComponents = {
    method: method.toUpperCase(),
    path: parsedUrl.pathname + (parsedUrl.search || ''),
    authority: parsedUrl.host,
  };

  const baseString = generateSignatureBase(
    signatureParams,
    signatureComponents,
    headers,
    timestamp
  );

  console.log('\n=== SIGNATURE BASE STRING ===');
  console.log(baseString);
  console.log('\n=== BASE STRING (escaped) ===');
  console.log(JSON.stringify(baseString));
  console.log('\n=== BASE STRING BYTES ===');
  console.log(Buffer.from(baseString).length, 'bytes');

  const formattedKey = formatPrivateKey(keys.privateKey);
  console.log('\n=== FORMATTED KEY (first 100 chars) ===');
  console.log(formattedKey.substring(0, 100) + '...');

  const privateKeyObject = crypto.createPrivateKey({
    key: formattedKey,
    format: 'pem',
  });

  console.log('\n=== KEY INFO ===');
  console.log('Key type:', privateKeyObject.asymmetricKeyType);
  console.log('Key size:', privateKeyObject.asymmetricKeyDetails);

  const signatureBuffer = crypto.sign(null, Buffer.from(baseString), privateKeyObject);
  const signatureBase64 = signatureBuffer.toString('base64');

  let signatureInputBuf = 'sig1=(';
  for (let i = 0; i < signatureParams.length; i++) {
    signatureInputBuf += '"' + signatureParams[i] + '"';
    if (i < signatureParams.length - 1) {
      signatureInputBuf += ' ';
    }
  }
  signatureInputBuf += ');created=' + timestamp.toString();

  const signatureHeader = 'sig1=:' + signatureBase64 + ':';

  console.log('\n=== SIGNATURE OUTPUT ===');
  console.log('Signature-Input:', signatureInputBuf);
  console.log('Signature:', signatureHeader.substring(0, 80) + '...');

  return {
    'x-ebay-signature-key': keys.jwe,
    'Content-Digest': headers['content-digest'],
    Signature: signatureHeader,
    'Signature-Input': signatureInputBuf,
    _baseString: baseString,
    _signatureBase64: signatureBase64,
  };
}

async function getClientCredentialsToken(): Promise<string | null> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET');
    return null;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to get client credentials token:', response.status, errorText);
    return null;
  }

  const data = await response.json();
  return data.access_token;
}

async function verifySigningKey(signingKeyId: string): Promise<string | null> {
  console.log('\n=== VERIFYING SIGNING KEY WITH EBAY ===');

  const clientToken = await getClientCredentialsToken();
  if (!clientToken) {
    console.log('Failed to get client credentials token');
    return null;
  }

  const response = await fetch(`https://apiz.ebay.com/developer/key_management/v1/signing_key/${signingKeyId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      Accept: 'application/json',
    },
  });

  console.log('Verify key response status:', response.status);
  const responseText = await response.text();
  console.log('Response:', responseText);

  if (response.ok) {
    const keyData = JSON.parse(responseText);
    return keyData.publicKey;
  }
  return null;
}

function verifySignatureLocally(
  baseString: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  console.log('\n=== LOCAL SIGNATURE VERIFICATION ===');
  console.log('Public key:', publicKeyPem);

  // The public key from eBay is in base64-encoded SPKI format
  // We need to wrap it in PEM headers
  const pemPublicKey = `-----BEGIN PUBLIC KEY-----\n${publicKeyPem}\n-----END PUBLIC KEY-----`;
  console.log('PEM Public key:', pemPublicKey);

  try {
    const publicKeyObject = crypto.createPublicKey({
      key: pemPublicKey,
      format: 'pem',
    });

    console.log('Public key type:', publicKeyObject.asymmetricKeyType);

    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const isValid = crypto.verify(null, Buffer.from(baseString), publicKeyObject, signatureBuffer);

    console.log('Signature valid locally:', isValid);
    return isValid;
  } catch (error) {
    console.error('Verification error:', error);
    return false;
  }
}

async function main() {
  console.log('=== eBay Signature Test ===\n');

  // Get signing keys from database using service role key to bypass RLS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // First authenticate
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    // Try to get keys directly without auth (for testing)
    console.log('No test credentials, trying direct query...');

    const { data: credentials, error } = await supabase
      .from('ebay_credentials')
      .select('signing_key_id, private_key, public_key, jwe, signing_key_expires_at, access_token')
      .limit(1)
      .single();

    if (error || !credentials) {
      console.error('Failed to get credentials:', error);
      console.log('\nTo test, set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.local');
      process.exit(1);
    }

    if (!credentials.signing_key_id || !credentials.private_key || !credentials.jwe) {
      console.error('No signing keys found in database. Generate them first via the UI.');
      process.exit(1);
    }

    const keys: EbaySigningKeys = {
      signingKeyId: credentials.signing_key_id,
      privateKey: credentials.private_key,
      publicKey: credentials.public_key || '',
      jwe: credentials.jwe,
      expiresAt: credentials.signing_key_expires_at || '',
    };

    console.log('Signing Key ID:', keys.signingKeyId);
    console.log('JWE (first 50 chars):', keys.jwe.substring(0, 50) + '...');
    console.log('\n=== RAW PRIVATE KEY FROM DB ===');
    console.log('First 200 chars:', keys.privateKey.substring(0, 200));
    console.log('Contains newlines:', keys.privateKey.includes('\n'));
    console.log('Contains escaped newlines:', keys.privateKey.includes('\\n'));

    // Derive public key from private key and compare
    console.log('\n=== VERIFYING KEY PAIR ===');
    const formattedPrivateKey = formatPrivateKey(keys.privateKey);
    const privKeyObj = crypto.createPrivateKey({ key: formattedPrivateKey, format: 'pem' });
    const derivedPubKey = crypto.createPublicKey(privKeyObj);
    const exportedPubKey = derivedPubKey.export({ type: 'spki', format: 'der' });
    const pubKeyBase64 = exportedPubKey.toString('base64');
    console.log('Derived public key:', pubKeyBase64);
    console.log('Public key in DB:', keys.publicKey || '(not stored)');

    // Verify the signing key exists at eBay and get public key
    const publicKey = await verifySigningKey(keys.signingKeyId);

    // Test signing a transaction request
    // Test multiple endpoints - some with and without query params
    const endpoints = [
      'https://apiz.ebay.com/sell/finances/v1/seller_funds_summary',
      'https://apiz.ebay.com/sell/finances/v1/transaction',  // No query params
      'https://apiz.ebay.com/sell/finances/v1/payout',       // No query params
    ];

    const testUrl = endpoints[0]; // Start with seller_funds_summary

    // Also test the non-signed endpoint to verify our access token works
    console.log('\n=== Testing non-signed API endpoint first ===');
    const testNonSignedUrl = 'https://api.ebay.com/sell/fulfillment/v1/order?limit=1';
    try {
      const nonSignedResponse = await fetch(testNonSignedUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${credentials.access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      console.log('Non-signed API status:', nonSignedResponse.status);
      if (!nonSignedResponse.ok) {
        const errText = await nonSignedResponse.text();
        console.log('Non-signed API error:', errText.substring(0, 200));
      } else {
        console.log('Non-signed API works - access token is valid');
      }
    } catch (e) {
      console.log('Non-signed API fetch error:', e);
    }

    console.log('\n=== Testing signature for URL ===');
    console.log('URL:', testUrl);
    console.log('Method: GET');

    const signedHeaders = signRequest(keys, 'GET', testUrl);

    // Verify signature locally using the public key from eBay
    if (publicKey) {
      verifySignatureLocally(
        signedHeaders._baseString,
        signedHeaders._signatureBase64,
        publicKey
      );
    }

    console.log('\n=== MAKING TEST REQUEST ===');

    const accessToken = credentials.access_token;
    if (!accessToken) {
      console.log('No access token found. Skipping API call.');
      return;
    }

    try {
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-ebay-signature-key': signedHeaders['x-ebay-signature-key'],
        'x-ebay-enforce-signature': 'true',  // Required per working example
        'Signature': signedHeaders.Signature,  // Capitalized per StackOverflow example
        'Signature-Input': signedHeaders['Signature-Input'],  // Capitalized per StackOverflow example
      };

      console.log('\n=== REQUEST HEADERS ===');
      Object.entries(requestHeaders).forEach(([key, value]) => {
        if (key === 'Authorization') {
          console.log(`${key}: Bearer ${value.substring(7, 30)}...`);
        } else if (value && value.length > 80) {
          console.log(`${key}: ${value.substring(0, 80)}...`);
        } else {
          console.log(`${key}: ${value}`);
        }
      });

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: requestHeaders,
      });

      console.log('\n=== RESPONSE ===');
      console.log('Status:', response.status, response.statusText);

      const responseText = await response.text();

      if (!response.ok) {
        console.log('Error response:', responseText);

        // Parse and display eBay error details
        try {
          const errorJson = JSON.parse(responseText);
          console.log('\nParsed error:');
          console.log(JSON.stringify(errorJson, null, 2));
        } catch {
          // Not JSON
        }
      } else {
        console.log('Success! First 500 chars:');
        console.log(responseText.substring(0, 500));
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
    }

    // Test additional endpoints
    console.log('\n\n=== TESTING ALL FINANCES API ENDPOINTS ===');
    for (const endpoint of endpoints.slice(1)) {
      console.log(`\n--- Testing: ${endpoint} ---`);
      const signedHeadersForEndpoint = signRequest(keys, 'GET', endpoint);

      try {
        const endpointResponse = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-ebay-signature-key': signedHeadersForEndpoint['x-ebay-signature-key'],
            'x-ebay-enforce-signature': 'true',
            'Signature': signedHeadersForEndpoint.Signature,
            'Signature-Input': signedHeadersForEndpoint['Signature-Input'],
          },
        });

        console.log('Status:', endpointResponse.status, endpointResponse.statusText);

        const endpointText = await endpointResponse.text();
        if (endpointResponse.ok) {
          console.log('Success! First 300 chars:', endpointText.substring(0, 300));
        } else {
          console.log('Error:', endpointText.substring(0, 200));
        }
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }
  }
}

main().catch(console.error);
