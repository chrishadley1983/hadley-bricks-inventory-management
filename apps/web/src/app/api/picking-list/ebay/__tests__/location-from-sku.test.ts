import { describe, it, expect } from 'vitest';
import { locationFromSku } from '../location-from-sku';

// eBay SKU convention: "U<id> - <location>", e.g. "U2222 - Garage - E1".
// The location segment may itself contain " - " separators.
describe('locationFromSku', () => {
  it('extracts a simple location', () => {
    expect(locationFromSku('U2222 - Garage - E1')).toBe('Garage - E1');
  });

  it('keeps multi-segment locations intact', () => {
    expect(locationFromSku('U2661 - Garage - EBAY USED BOXED')).toBe(
      'Garage - EBAY USED BOXED'
    );
    expect(locationFromSku('U2081 - Filing Cabinet')).toBe('Filing Cabinet');
  });

  it('tolerates loose spacing around the first separator', () => {
    expect(locationFromSku('U234- Garage - 101')).toBe('Garage - 101');
    expect(locationFromSku('U234 -Garage - 101')).toBe('Garage - 101');
  });

  it('returns null when the SKU has no location segment', () => {
    expect(locationFromSku('U2222')).toBeNull();
    expect(locationFromSku('U2222 - ')).toBeNull();
    expect(locationFromSku('8531')).toBeNull();
    expect(locationFromSku('LEGO-8531-NEW')).toBeNull();
  });

  it('returns null for null or empty SKU', () => {
    expect(locationFromSku(null)).toBeNull();
    expect(locationFromSku('')).toBeNull();
  });
});
