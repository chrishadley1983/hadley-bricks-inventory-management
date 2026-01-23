/**
 * API Route: /api/home-costs/[id]
 * PATCH - Update existing home cost entry
 * DELETE - Remove home cost entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  HomeCostRow,
  transformHomeCostRow,
  dateRangesOverlap,
} from '@/types/home-costs';

/**
 * Zod schema for updating home costs
 */
const UpdateHomeCostSchema = z
  .object({
    hoursPerMonth: z.enum(['25-50', '51-100', '101+']).optional(),
    description: z.enum(['Mobile Phone', 'Home Broadband', 'Landline']).optional(),
    monthlyCost: z.number().positive('Monthly cost must be positive').optional(),
    businessPercent: z.number().int().min(1).max(100).optional(),
    annualPremium: z.number().positive('Annual premium must be positive').optional(),
    businessStockValue: z.number().positive('Business stock value must be positive').optional(),
    totalContentsValue: z.number().positive('Total contents value must be positive').optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}$/, 'Start date must be YYYY-MM format').optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'End date must be YYYY-MM format')
      .nullable()
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    { message: 'End date must be on or after start date' }
  )
  .refine(
    (data) => {
      if (data.businessStockValue !== undefined && data.totalContentsValue !== undefined) {
        return data.businessStockValue <= data.totalContentsValue;
      }
      return true;
    },
    { message: 'Business stock value cannot exceed total contents value' }
  );

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/home-costs/[id]
 * Updates an existing home cost entry
 * F8: Returns 200 with updated cost
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch existing entry
    const { data: existing, error: fetchError } = await supabase
      .from('home_costs')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Home cost not found' }, { status: 404 });
    }

    const body = await request.json();
    const parsed = UpdateHomeCostSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const existingRow = existing as HomeCostRow;

    // Check for overlapping entries if dates changed
    if (data.startDate !== undefined || data.endDate !== undefined) {
      const newStartDate = data.startDate || existingRow.start_date.substring(0, 7);
      const newEndDate =
        data.endDate !== undefined
          ? data.endDate
          : existingRow.end_date
            ? existingRow.end_date.substring(0, 7)
            : null;

      const { data: otherCosts } = await supabase
        .from('home_costs')
        .select('*')
        .eq('user_id', user.id)
        .eq('cost_type', existingRow.cost_type)
        .neq('id', id);

      if (otherCosts && otherCosts.length > 0) {
        const newEntry = { startDate: newStartDate, endDate: newEndDate };
        const newDescription = data.description || existingRow.description;

        for (const other of otherCosts as HomeCostRow[]) {
          // For phone_broadband, only check same description
          if (existingRow.cost_type === 'phone_broadband') {
            if (other.description !== newDescription) continue;
          }

          const otherEntry = {
            startDate: other.start_date.substring(0, 7),
            endDate: other.end_date ? other.end_date.substring(0, 7) : null,
          };

          if (dateRangesOverlap(newEntry, otherEntry)) {
            return NextResponse.json(
              { error: 'This change would create overlapping date ranges' },
              { status: 400 }
            );
          }
        }
      }
    }

    // Also validate insurance constraint with potentially mixed old/new values
    if (existingRow.cost_type === 'insurance') {
      const stockValue = data.businessStockValue ?? existingRow.business_stock_value ?? 0;
      const totalValue = data.totalContentsValue ?? existingRow.total_contents_value ?? 0;
      if (stockValue > totalValue) {
        return NextResponse.json(
          { error: 'Business stock value cannot exceed total contents value' },
          { status: 400 }
        );
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (data.startDate !== undefined) {
      updateData.start_date = `${data.startDate}-01`;
    }
    if (data.endDate !== undefined) {
      updateData.end_date = data.endDate ? `${data.endDate}-01` : null;
    }

    // Cost-type specific fields
    if (data.hoursPerMonth !== undefined) updateData.hours_per_month = data.hoursPerMonth;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.monthlyCost !== undefined) updateData.monthly_cost = data.monthlyCost;
    if (data.businessPercent !== undefined) updateData.business_percent = data.businessPercent;
    if (data.annualPremium !== undefined) updateData.annual_premium = data.annualPremium;
    if (data.businessStockValue !== undefined)
      updateData.business_stock_value = data.businessStockValue;
    if (data.totalContentsValue !== undefined)
      updateData.total_contents_value = data.totalContentsValue;

    const { data: updated, error: updateError } = await supabase
      .from('home_costs')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('[PATCH /api/home-costs/:id] Update error:', updateError);
      throw updateError;
    }

    return NextResponse.json({ data: transformHomeCostRow(updated as HomeCostRow) });
  } catch (error) {
    console.error('[PATCH /api/home-costs/:id] Error:', error);
    return NextResponse.json({ error: 'Failed to update home cost' }, { status: 500 });
  }
}

/**
 * DELETE /api/home-costs/[id]
 * Removes a home cost entry
 * F9: Returns 200 on success
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error: deleteError } = await supabase
      .from('home_costs')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('[DELETE /api/home-costs/:id] Delete error:', deleteError);
      throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/home-costs/:id] Error:', error);
    return NextResponse.json({ error: 'Failed to delete home cost' }, { status: 500 });
  }
}
