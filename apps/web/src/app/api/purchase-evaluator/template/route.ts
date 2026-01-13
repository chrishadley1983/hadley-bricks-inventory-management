/**
 * Purchase Evaluator Template API Route
 *
 * GET - Download CSV template
 */

import { NextResponse } from 'next/server';
import { generateTemplate } from '@/lib/purchase-evaluator';

/**
 * GET /api/purchase-evaluator/template
 * Download a CSV template for purchase evaluation
 */
export async function GET() {
  const template = generateTemplate();

  return new NextResponse(template, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="purchase-evaluation-template.csv"',
    },
  });
}
