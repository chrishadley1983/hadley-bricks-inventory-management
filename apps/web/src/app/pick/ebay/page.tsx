import { createPublicClient } from '@/lib/supabase/server';
import { InteractivePickList } from '../_components/InteractivePickList';

export const dynamic = 'force-dynamic';

export default async function EbayPickPage() {
  const supabase = createPublicClient();

  const { data: snapshot } = await supabase
    .from('picklist_snapshots')
    .select('data, generated_at')
    .eq('platform', 'ebay')
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  if (!snapshot) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-muted-foreground">No eBay pick list has been generated yet.</p>
      </div>
    );
  }

  return (
    <InteractivePickList
      platform="ebay"
      data={snapshot.data as Record<string, unknown>}
      generatedAt={snapshot.generated_at}
    />
  );
}
