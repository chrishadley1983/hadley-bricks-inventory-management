import { describe, it, expect } from 'vitest';
import { buildColourMapFromRows, normColourName, type ColourMapRow } from '../colour-map';

const rows: ColourMapRow[] = [
  { bl_colour_id: 0, bl_colour_name: '(Not Applicable)', bricqer_colour_id: 1, bricqer_colour_name: '(Not Applicable)', rgb: null },
  { bl_colour_id: 11, bl_colour_name: 'Black', bricqer_colour_id: 3, bricqer_colour_name: 'Black', rgb: '#212121' },
  { bl_colour_id: 1, bl_colour_name: 'White', bricqer_colour_id: 76, bricqer_colour_name: 'White', rgb: '#FFFFFF' },
  { bl_colour_id: 86, bl_colour_name: 'Light Bluish Gray', bricqer_colour_id: 34, bricqer_colour_name: 'Light Bluish Gray', rgb: null },
  { bl_colour_id: 999, bl_colour_name: 'Rare No-Bricqer Colour', bricqer_colour_id: null, bricqer_colour_name: null, rgb: null },
];

describe('colour-map', () => {
  const m = buildColourMapFromRows(rows);

  it('normalises names consistently', () => {
    expect(normColourName('  Dark  Bluish   Gray ')).toBe('dark bluish gray');
    expect(normColourName(null)).toBe('');
  });

  it('maps Bricqer id -> BL id (canonical)', () => {
    expect(m.toBl(3, 'bricqer')).toBe(11); // Bricqer Black -> BL Black
    expect(m.toBl(76, 'bricqer')).toBe(1); // Bricqer White -> BL White
    expect(m.toBl(11, 'bl')).toBe(11); // BL identity
  });

  it('maps BL id -> Bricqer id', () => {
    expect(m.toBricqer(11)).toBe(3);
    expect(m.toBricqer(999)).toBeNull(); // no bricqer equivalent
  });

  it('round-trips mapped colours', () => {
    for (const bl of [11, 1, 86]) {
      const bq = m.toBricqer(bl)!;
      expect(m.toBl(bq, 'bricqer')).toBe(bl);
    }
  });

  it('normalises by name across schemes', () => {
    expect(m.normalise({ colourName: 'black', scheme: 'bricqer' })).toMatchObject({ blId: 11, mapped: true });
    expect(m.normalise({ colourName: 'Light Bluish Gray', scheme: 'bl' })).toMatchObject({ blId: 86 });
  });

  it('collapses no-colour to BL 0', () => {
    expect(m.normalise({ colourName: '(Not Applicable)', scheme: 'bricqer' }).blId).toBe(0);
    expect(m.name(0)).toBe('(Not Applicable)');
  });

  it('flags unmapped bricqer ids (identity fallback, mapped=false)', () => {
    const r = m.normalise({ colourId: 4242, scheme: 'bricqer' });
    expect(r.blId).toBe(4242);
    expect(r.mapped).toBe(false);
  });
});
