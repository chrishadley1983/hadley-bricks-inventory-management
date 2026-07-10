/**
 * Store-assessment page fonts — the "trading-desk ledger" type pairing.
 * Barlow Condensed carries the display numerals and section kickers (industrial,
 * space-efficient); IBM Plex Mono carries every data figure (true tabular money).
 * Scoped to these pages via CSS variables so the rest of the app is untouched.
 */
import { Barlow_Condensed, IBM_Plex_Mono } from 'next/font/google';

export const displayFont = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-sa-display',
  display: 'swap',
});

export const dataFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sa-mono',
  display: 'swap',
});

/** Root className for any store-assessment page: exposes both font vars. */
export const saFonts = `${displayFont.variable} ${dataFont.variable}`;
