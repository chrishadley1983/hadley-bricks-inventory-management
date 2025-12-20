import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BricqerClient, type BricqerCredentials } from '@/lib/bricqer';
import { CredentialsRepository } from '@/lib/repositories';

/**
 * GET /api/integrations/bricqer/storage
 * Get storage locations from Bricqer
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

    // Get credentials
    const credentialsRepo = new CredentialsRepository(supabase);
    const credentials = await credentialsRepo.getCredentials<BricqerCredentials>(
      user.id,
      'bricqer'
    );

    if (!credentials) {
      return NextResponse.json(
        { error: 'Bricqer credentials not configured' },
        { status: 400 }
      );
    }

    const client = new BricqerClient(credentials);
    const storageLocations = await client.getStorageLocations();

    return NextResponse.json({
      data: storageLocations.map((storage) => ({
        id: storage.id,
        label: storage.displayAs,
        storageId: storage.storageId,
        type: storage.storageType,
        itemCount: storage.itemCount,
        priority: storage.priority,
        isDropship: storage.isDropship,
        isStorefront: storage.isStorefront,
      })),
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/storage] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
