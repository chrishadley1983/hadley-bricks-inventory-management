/**
 * API Route: /api/home-costs
 * GET - List all home costs + settings for user
 * POST - Create new home cost entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  HomeCostRow,
  HomeCostsSettingsRow,
  transformHomeCostRow,
  dateRangesOverlap,
} from '@/types/home-costs';

/**
 * Zod schema for creating home costs using discriminated union
 */
const CreateHomeCostSchema = z
  .discriminatedUnion('costType', [
    z.object({
      costType: z.literal('use_of_home'),
      hoursPerMonth: z.enum(['25-50', '51-100', '101+']),
      startDate: z.string().regex(/^\d{4}-\d{2}$/, 'Start date must be YYYY-MM format'),
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}$/, 'End date must be YYYY-MM format')
        .nullable(),
    }),
    z.object({
      costType: z.literal('phone_broadband'),
      description: z.enum(['Mobile Phone', 'Home Broadband', 'Landline']),
      monthlyCost: z.number().positive('Monthly cost must be positive'),
      businessPercent: z.number().int().min(1).max(100),
      startDate: z.string().regex(/^\d{4}-\d{2}$/, 'Start date must be YYYY-MM format'),
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}$/, 'End date must be YYYY-MM format')
        .nullable(),
    }),
    z.object({
      costType: z.literal('insurance'),
      annualPremium: z.number().positive('Annual premium must be positive'),
      businessStockValue: z.number().positive('Business stock value must be positive'),
      totalContentsValue: z.number().positive('Total contents value must be positive'),
      startDate: z.string().regex(/^\d{4}-\d{2}$/, 'Start date must be YYYY-MM format'),
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}$/, 'End date must be YYYY-MM format')
        .nullable(),
    }),
  ])
  .refine((data) => !data.endDate || data.endDate >= data.startDate, {
    message: 'End date must be on or after start date',
  })
  .refine(
    (data) => data.costType !== 'insurance' || data.businessStockValue <= data.totalContentsValue,
    {
      message: 'Business stock value cannot exceed total contents value',
    }
  );

/**
 * GET /api/home-costs
 * Returns all home costs and settings for authenticated user
 * F6: Returns costs array and settings object
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch costs
    const { data: costsData, error: costsError } = await supabase
      .from('home_costs')
      .select('*')
      .eq('user_id', user.id)
      .order('cost_type')
      .order('start_date', { ascending: false });

    if (costsError) {
      console.error('[GET /api/home-costs] Costs error:', costsError);
      throw costsError;
    }

    // Fetch settings (may not exist yet)
    const { data: settingsData } = await supabase
      .from('home_costs_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // Transform costs to API format
    const costs = (costsData as HomeCostRow[]).map(transformHomeCostRow);

    // Default settings if not set
    const settings = {
      displayMode: (settingsData as HomeCostsSettingsRow | null)?.display_mode || 'separate',
    };

    return NextResponse.json({ costs, settings });
  } catch (error) {
    console.error('[GET /api/home-costs] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch home costs' }, { status: 500 });
  }
}

/**
 * POST /api/home-costs
 * Creates a new home cost entry
 * F7: Returns 201 with created cost
 * F27, F40, F51: Prevents overlapping entries
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = CreateHomeCostSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Check for overlapping entries
    const { data: existingCosts } = await supabase
      .from('home_costs')
      .select('*')
      .eq('user_id', user.id)
      .eq('cost_type', data.costType);

    if (existingCosts && existingCosts.length > 0) {
      const newEntry = {
        startDate: data.startDate,
        endDate: data.endDate,
      };

      for (const existing of existingCosts as HomeCostRow[]) {
        const existingEntry = {
          startDate: existing.start_date.substring(0, 7),
          endDate: existing.end_date ? existing.end_date.substring(0, 7) : null,
        };

        // For phone_broadband, only check same description
        if (data.costType === 'phone_broadband') {
          if (existing.description !== data.description) continue;
        }

        if (dateRangesOverlap(newEntry, existingEntry)) {
          return NextResponse.json(
            {
              error:
                data.costType === 'phone_broadband'
                  ? `An entry for ${data.description} already exists in this date range`
                  : `An overlapping ${data.costType.replace('_', ' ')} entry already exists`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Build insert data based on cost type
    const insertData: Record<string, unknown> = {
      user_id: user.id,
      cost_type: data.costType,
      start_date: `${data.startDate}-01`, // Convert YYYY-MM to YYYY-MM-DD
      end_date: data.endDate ? `${data.endDate}-01` : null,
    };

    switch (data.costType) {
      case 'use_of_home':
        insertData.hours_per_month = data.hoursPerMonth;
        break;
      case 'phone_broadband':
        insertData.description = data.description;
        insertData.monthly_cost = data.monthlyCost;
        insertData.business_percent = data.businessPercent;
        break;
      case 'insurance':
        insertData.annual_premium = data.annualPremium;
        insertData.business_stock_value = data.businessStockValue;
        insertData.total_contents_value = data.totalContentsValue;
        break;
    }

    const { data: created, error: insertError } = await supabase
      .from('home_costs')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(insertData as any)
      .select()
      .single();

    if (insertError) {
      console.error('[POST /api/home-costs] Insert error:', insertError);
      throw insertError;
    }

    return NextResponse.json(
      { data: transformHomeCostRow(created as HomeCostRow) },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/home-costs] Error:', error);
    return NextResponse.json({ error: 'Failed to create home cost' }, { status: 500 });
  }
}
