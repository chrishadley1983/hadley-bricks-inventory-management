import { describe, it, expect } from 'vitest';
import { isIncompleteSetListing } from '../listing-completeness';

describe('isIncompleteSetListing', () => {
  it('flags via the invComplete code', () => {
    expect(isIncompleteSetListing('B', null)).toBe(true);
    expect(isIncompleteSetListing('Incomplete', null)).toBe(true);
    expect(isIncompleteSetListing('C', null)).toBe(false);
    expect(isIncompleteSetListing('S', null)).toBe(false); // sealed = complete
  });

  it('flags the real Gibbo0o descriptions that slipped through', () => {
    expect(isIncompleteSetListing(null, 'SHIP BUILD & INSTRUCTIONS ONLY - NO FIGURE OR BOX')).toBe(true);
    expect(
      isIncompleteSetListing(
        'C',
        'NO minifigures or their respective weapons or box are included. Bags have been opened to remove these pieces and then resealed.',
      ),
    ).toBe(true);
  });

  it('does not flag clean listings', () => {
    expect(isIncompleteSetListing(null, null)).toBe(false);
    expect(isIncompleteSetListing('C', 'Excellent condition, complete with instructions and box')).toBe(false);
    expect(isIncompleteSetListing(null, 'Retired set, great gift')).toBe(false);
  });
});
