/**
 * eBay Digital Signature Service
 *
 * Handles generating and signing requests for eBay APIs that require digital signatures.
 * The Finances API requires signed requests for EU/UK-domiciled sellers.
 *
 * Uses eBay's official digital-signature-nodejs-sdk helper functions plus
 * custom key handling for ED25519 compatibility with Node.js crypto.
 */

import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import { generateDigestHeader } from 'digital-signature-nodejs-sdk';

// ============================================================================
// Types
// ============================================================================

export interface EbaySigningKeys {
  signingKeyId: string;
  privateKey: string;
  publicKey: string;
  jwe: string;
  expiresAt: string;
}

export interface SignedRequestHeaders {
  'x-ebay-signature-key': string;
  'x-ebay-enforce-signature': string;
  'Content-Digest'?: string;
  Signature: string;
  'Signature-Input': string;
}


// ============================================================================
// Constants
// ============================================================================

const EBAY_KEY_MANAGEMENT_URL = 'https://apiz.ebay.com/developer/key_management/v1';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const KEY_VALIDITY_DAYS = 365 * 3; // 3 years per eBay docs

// ============================================================================
// EbaySignatureService Class
// ============================================================================

export class EbaySignatureService {
  /**
   * Get a client credentials token for Key Management API
   * The Key Management API requires application-level auth, not user OAuth tokens
   */
  private async getClientCredentialsToken(): Promise<string | null> {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('[EbaySignatureService] Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET');
      return null;
    }

    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const response = await fetch(EBAY_TOKEN_URL, {
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
        console.error('[EbaySignatureService] Failed to get client credentials token:', response.status, errorText);
        return null;
      }

      const data = await response.json();
      return data.access_token;
    } catch (error) {
      console.error('[EbaySignatureService] Error getting client credentials token:', error);
      return null;
    }
  }

  /**
   * Get or create signing keys for a user
   */
  async getSigningKeys(userId: string, accessToken: string): Promise<EbaySigningKeys | null> {
    const supabase = await createClient();

    // Check if we have valid keys stored
    const { data: credentials } = await supabase
      .from('ebay_credentials')
      .select('signing_key_id, private_key, public_key, jwe, signing_key_expires_at')
      .eq('user_id', userId)
      .single();

    if (credentials?.signing_key_id && credentials?.private_key && credentials?.jwe) {
      // Check if keys are still valid
      const expiresAt = credentials.signing_key_expires_at
        ? new Date(credentials.signing_key_expires_at)
        : null;

      if (!expiresAt || expiresAt > new Date()) {
        console.log('[EbaySignatureService] Using existing signing keys');
        return {
          signingKeyId: credentials.signing_key_id,
          privateKey: credentials.private_key,
          publicKey: credentials.public_key || '',
          jwe: credentials.jwe,
          expiresAt: credentials.signing_key_expires_at || '',
        };
      }

      console.log('[EbaySignatureService] Signing keys expired, need to regenerate');
    }

    // No valid keys - need to create new ones via Key Management API
    console.log('[EbaySignatureService] No signing keys found, creating new ones');
    return this.createSigningKeys(userId, accessToken);
  }

  /**
   * Create new signing keys via eBay Key Management API
   * Note: The Key Management API requires client credentials flow, not user OAuth tokens
   */
  async createSigningKeys(userId: string, _accessToken: string): Promise<EbaySigningKeys | null> {
    console.log('[EbaySignatureService] Calling eBay Key Management API to create signing key');

    try {
      // Get a client credentials token for the Key Management API
      const clientToken = await this.getClientCredentialsToken();
      if (!clientToken) {
        console.error('[EbaySignatureService] Failed to get client credentials token');
        return null;
      }

      const response = await fetch(`${EBAY_KEY_MANAGEMENT_URL}/signing_key`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          signingKeyCipher: 'ED25519', // EdDSA algorithm
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          '[EbaySignatureService] Failed to create signing key:',
          response.status,
          errorBody
        );

        // If 403, the user may not have access to Key Management API
        if (response.status === 403) {
          console.warn(
            '[EbaySignatureService] Access denied to Key Management API - user may not be EU/UK domiciled or API not available'
          );
          return null;
        }

        throw new Error(`Failed to create signing key: ${response.status} ${errorBody}`);
      }

      const keyData = (await response.json()) as {
        signingKeyId: string;
        privateKey: string;
        publicKey: string;
        jwe: string;
        creationTime: number; // Unix timestamp in seconds
        expirationTime: number; // Unix timestamp in seconds
      };

      console.log('[EbaySignatureService] Signing key created:', keyData.signingKeyId);
      console.log('[EbaySignatureService] Expiration timestamp:', keyData.expirationTime);
      console.log('[EbaySignatureService] Private key format:', keyData.privateKey.substring(0, 50) + '...');

      // Convert Unix timestamp (seconds) to ISO string
      // eBay returns timestamps in seconds, JavaScript Date uses milliseconds
      let expiresAtIso: string;
      if (keyData.expirationTime) {
        const expiresAtDate = new Date(keyData.expirationTime * 1000);
        expiresAtIso = expiresAtDate.toISOString();
        console.log('[EbaySignatureService] Expiration date:', expiresAtIso);
      } else {
        // Fallback: 3 years from now
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + KEY_VALIDITY_DAYS);
        expiresAtIso = expiresAt.toISOString();
      }

      // Store the keys in the database
      const supabase = await createClient();
      const { error } = await supabase
        .from('ebay_credentials')
        .update({
          signing_key_id: keyData.signingKeyId,
          private_key: keyData.privateKey,
          public_key: keyData.publicKey,
          jwe: keyData.jwe,
          signing_key_expires_at: expiresAtIso,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (error) {
        console.error('[EbaySignatureService] Failed to store signing keys:', error);
        throw new Error('Failed to store signing keys');
      }

      return {
        signingKeyId: keyData.signingKeyId,
        privateKey: keyData.privateKey,
        publicKey: keyData.publicKey,
        jwe: keyData.jwe,
        expiresAt: expiresAtIso,
      };
    } catch (error) {
      console.error('[EbaySignatureService] Error creating signing keys:', error);
      return null;
    }
  }

  /**
   * Format ED25519 private key to proper PEM format for Node.js crypto
   * eBay returns the key in PEM format, but database storage can corrupt newlines
   */
  private formatPrivateKey(privateKey: string): string {
    // Fix escaped newlines from database storage
    let formatted = privateKey.replace(/\\n/g, '\n');

    // If already in PEM format, ensure proper structure
    if (formatted.includes('-----BEGIN')) {
      // Remove any carriage returns
      formatted = formatted.replace(/\r/g, '');

      // Extract the base64 content between headers
      const match = formatted.match(/-----BEGIN [A-Z ]+-----\s*([\s\S]*?)\s*-----END [A-Z ]+-----/);
      if (match) {
        const base64Content = match[1].replace(/\s/g, ''); // Remove all whitespace from base64
        // Reconstruct with proper 64-char line breaks
        const lines: string[] = [];
        for (let i = 0; i < base64Content.length; i += 64) {
          lines.push(base64Content.substring(i, i + 64));
        }
        formatted = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
      }

      return formatted;
    }

    // If it's raw base64, wrap it in PKCS#8 PEM headers for ED25519
    const cleanBase64 = privateKey.replace(/\s/g, '');
    const lines: string[] = [];
    for (let i = 0; i < cleanBase64.length; i += 64) {
      lines.push(cleanBase64.substring(i, i + 64));
    }
    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
  }

  /**
   * Generate the signature base string per RFC 9421
   *
   * CRITICAL: Each line ends with \n EXCEPT the last line (@signature-params).
   * The working format is:
   * "x-ebay-signature-key": {jwe}
   * "@method": GET
   * "@path": /path
   * "@authority": host
   * "@signature-params": ("x-ebay-signature-key" "@method" "@path" "@authority");created=timestamp
   *
   * Lines are joined with \n - no trailing newline after @signature-params
   */
  private generateSignatureBase(
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
        // Regular header - lookup by exact param name
        const headerValue = headers[param];
        if (!headerValue) {
          throw new Error(`Header ${param} not found in headers`);
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
   * Sign a request for eBay APIs requiring digital signatures
   * Custom implementation for ED25519 keys with proper Node.js crypto handling
   */
  signRequest(
    keys: EbaySigningKeys,
    method: string,
    url: string,
    body?: string
  ): SignedRequestHeaders {
    const parsedUrl = new URL(url);
    const timestamp = Math.floor(Date.now() / 1000);

    // Build headers object - keys must match exactly what's in signatureParams
    const headers: Record<string, string> = {
      'x-ebay-signature-key': keys.jwe,
    };

    // Signature params - the components that will be signed
    // Order per eBay documentation for GET requests (no body)
    const signatureParams = ['x-ebay-signature-key', '@method', '@path', '@authority'];

    // Add content-digest for requests with body
    if (body) {
      const contentDigest = generateDigestHeader(Buffer.from(body, 'utf-8'), 'sha256');
      headers['content-digest'] = contentDigest;
      // Content-digest goes at the beginning for POST requests
      signatureParams.unshift('content-digest');
    }

    // Signature components for derived values
    // IMPORTANT: @path should NOT include query parameters
    // eBay's signature validation expects only the pathname
    const signatureComponents = {
      method: method.toUpperCase(),
      path: parsedUrl.pathname,  // Do NOT include query params
      authority: parsedUrl.host,
    };

    // Generate signature base string (matching SDK format)
    const baseString = this.generateSignatureBase(
      signatureParams,
      signatureComponents,
      headers,
      timestamp
    );

    console.log('[EbaySignatureService] Signature base string:');
    console.log(baseString);
    console.log('[EbaySignatureService] Base string bytes:', Buffer.from(baseString).length);

    // Format the private key for ED25519
    const formattedKey = this.formatPrivateKey(keys.privateKey);
    console.log('[EbaySignatureService] Key format check:', formattedKey.substring(0, 50) + '...');

    // Create key object and sign with ED25519
    // For ED25519, we pass null as the algorithm - Node.js auto-detects from key type
    const privateKeyObject = crypto.createPrivateKey({
      key: formattedKey,
      format: 'pem',
    });

    console.log('[EbaySignatureService] Key type:', privateKeyObject.asymmetricKeyType);

    // Sign the base string with ED25519
    const signatureBuffer = crypto.sign(null, Buffer.from(baseString), privateKeyObject);
    const signatureBase64 = signatureBuffer.toString('base64');

    // Build signature-input header (matching SDK format)
    let signatureInputBuf = 'sig1=(';
    for (let i = 0; i < signatureParams.length; i++) {
      signatureInputBuf += '"' + signatureParams[i] + '"';
      if (i < signatureParams.length - 1) {
        signatureInputBuf += ' ';
      }
    }
    signatureInputBuf += ');created=' + timestamp.toString();

    const signatureHeader = 'sig1=:' + signatureBase64 + ':';

    console.log('[EbaySignatureService] Signature-Input:', signatureInputBuf);
    console.log('[EbaySignatureService] Signature:', signatureHeader.substring(0, 50) + '...');

    return {
      'x-ebay-signature-key': keys.jwe,
      'x-ebay-enforce-signature': 'true',
      'Content-Digest': headers['content-digest'],
      Signature: signatureHeader,
      'Signature-Input': signatureInputBuf,
    };
  }

  /**
   * Check if signing keys exist for a user (without creating new ones)
   */
  async hasSigningKeys(userId: string): Promise<boolean> {
    const supabase = await createClient();

    const { data } = await supabase
      .from('ebay_credentials')
      .select('signing_key_id, jwe, signing_key_expires_at')
      .eq('user_id', userId)
      .single();

    if (!data?.signing_key_id || !data?.jwe) {
      return false;
    }

    // Check expiration
    if (data.signing_key_expires_at) {
      const expiresAt = new Date(data.signing_key_expires_at);
      return expiresAt > new Date();
    }

    return true;
  }

  /**
   * Delete signing keys for a user (useful for re-authentication)
   */
  async deleteSigningKeys(userId: string): Promise<void> {
    const supabase = await createClient();

    await supabase
      .from('ebay_credentials')
      .update({
        signing_key_id: null,
        private_key: null,
        public_key: null,
        jwe: null,
        signing_key_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  /**
   * Regenerate signing keys - deletes existing and creates new ones
   */
  async regenerateSigningKeys(userId: string, accessToken: string): Promise<EbaySigningKeys | null> {
    console.log('[EbaySignatureService] Regenerating signing keys for user:', userId);
    await this.deleteSigningKeys(userId);
    return this.createSigningKeys(userId, accessToken);
  }
}

// Export a default instance
export const ebaySignatureService = new EbaySignatureService();
