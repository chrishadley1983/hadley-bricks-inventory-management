import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  businessName: z.string().optional(),
});

/**
 * POST /api/auth/register
 * Register a new user account
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { email, password, businessName } = parsed.data;
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          business_name: businessName,
        },
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Check if email confirmation is required
    if (data.user && !data.session) {
      return NextResponse.json(
        {
          message: 'Please check your email to confirm your account',
          user: { id: data.user.id, email: data.user.email },
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        message: 'Account created successfully',
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/auth/register] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
