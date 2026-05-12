/**
 * Compute Chris's actual sell-through during Sep/Oct 2025 (open store months).
 *   sellThru = pieces sold in period / avg inventory pieces in period
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createScriptBlContext } from './_bl-client';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const { bl, supabase } = createScriptBlContext('velocity-sep-oct-script');

(async () => {
  // ========= 1. BL orders in Sep + Oct 2025 =========
  const orders = await bl.getSalesOrders(undefined, true);
  console.log('Total BL sales orders (all time):', orders.length);

  // Date ranges
  const WINDOWS: Record<string, { from: string; to: string }> = {
    'Sep 2025': { from: '2025-09-01', to: '2025-10-01' },
    'Oct 2025': { from: '2025-10-01', to: '2025-11-01' },
    'Sep-Oct 2025': { from: '2025-09-01', to: '2025-11-01' },
    'Last 30 days (since re-open)': {
      from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      to: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    },
  };

  for (const [label, win] of Object.entries(WINDOWS)) {
    const winOrders = orders.filter((o) => {
      const d = o.date_ordered?.slice(0, 10) ?? '';
      return d >= win.from && d < win.to;
    });
    const pieces = winOrders.reduce((s, o) => s + (o.total_count ?? 0), 0);
    const lots = winOrders.reduce((s, o) => s + (o.unique_count ?? 0), 0);
    const days = (new Date(win.to).getTime() - new Date(win.from).getTime()) / 86400000;
    console.log(`\n[${label}] ${win.from} → ${win.to} (${days} days)`);
    console.log(`  orders: ${winOrders.length}`);
    console.log(`  pieces sold: ${pieces}`);
    console.log(`  unique lots sold: ${lots}`);
    console.log(`  pieces/day: ${(pieces / days).toFixed(1)}`);
    console.log(`  pieces/month: ${(pieces / days * 30).toFixed(0)}`);
  }

  // ========= 2. BL inventory pieces from bricklink_uploads =========
  // Cumulative pieces uploaded as of a date - sold so far ≈ inventory at that date.
  console.log('\n\n=== BL inventory (bricklink_uploads) ===');
  const { data: allUploads } = await supabase
    .from('bricklink_uploads')
    .select('upload_date, total_quantity, remaining_quantity, lots');
  if (!allUploads) { console.log('no uploads'); return; }
  console.log('Total batches: ' + allUploads.length);

  for (const [label, win] of Object.entries(WINDOWS)) {
    // Uploads active BEFORE/DURING window: sum of total_quantity where upload_date <= period_end
    const byEnd = allUploads.filter((u: any) => (u.upload_date ?? '').slice(0, 10) < win.to);
    const byStart = allUploads.filter((u: any) => (u.upload_date ?? '').slice(0, 10) < win.from);
    const piecesAtStart = byStart.reduce((s: number, u: any) => s + (u.total_quantity ?? 0), 0);
    const piecesAtEnd = byEnd.reduce((s: number, u: any) => s + (u.total_quantity ?? 0), 0);
    const lotsAtStart = byStart.reduce((s: number, u: any) => s + (u.lots ?? 0), 0);
    const lotsAtEnd = byEnd.reduce((s: number, u: any) => s + (u.lots ?? 0), 0);
    const avgPieces = (piecesAtStart + piecesAtEnd) / 2;
    const avgLots = (lotsAtStart + lotsAtEnd) / 2;
    const orders = (await bl.getSalesOrders(undefined, true)).filter((o) => {
      const d = o.date_ordered?.slice(0, 10) ?? '';
      return d >= win.from && d < win.to;
    });
    const piecesSold = orders.reduce((s, o) => s + (o.total_count ?? 0), 0);
    const lotsSold = orders.reduce((s, o) => s + (o.unique_count ?? 0), 0);
    const days = (new Date(win.to).getTime() - new Date(win.from).getTime()) / 86400000;
    const monthly = 30 / days;
    const pieceSellThru = avgPieces > 0 ? (piecesSold / avgPieces) * monthly : 0;
    const lotSellThru = avgLots > 0 ? (lotsSold / avgLots) * monthly : 0;
    const mosToClear = pieceSellThru > 0 ? 1 / pieceSellThru : Infinity;

    console.log(`\n[${label}]`);
    console.log(`  Inventory pieces (avg): ${avgPieces.toFixed(0)}  (start ${piecesAtStart}, end ${piecesAtEnd})`);
    console.log(`  Inventory lots (avg):   ${avgLots.toFixed(0)}`);
    console.log(`  Pieces sold:            ${piecesSold}`);
    console.log(`  Lots sold:              ${lotsSold}`);
    console.log(`  Monthly piece sellThru: ${(pieceSellThru * 100).toFixed(1)}%  → ${isFinite(mosToClear) ? mosToClear.toFixed(1) : '∞'} months to clear avg piece`);
    console.log(`  Monthly lot sellThru:   ${(lotSellThru * 100).toFixed(1)}%`);
  }
})();
