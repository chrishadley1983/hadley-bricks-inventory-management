import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AssessmentDetail } from '@/components/features/store-assessment/AssessmentView';
import { normalizeAssessment } from '@/lib/bl-store-assessment/normalize';

export const dynamic = 'force-dynamic';

interface AssessmentRow { assessment: unknown; scanned_at: string; mode: string }

export default async function StoreAssessmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { slug } = await params;
  const { mode } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let query = supabase
    .from('store_assessments')
    .select('assessment,scanned_at,mode')
    .eq('store_slug', slug)
    .order('scanned_at', { ascending: false })
    .limit(1);
  if (mode === 'full' || mode === 'light') query = query.eq('mode', mode);
  const { data } = await query.maybeSingle<AssessmentRow>();

  if (!data?.assessment) notFound();
  const assessment = normalizeAssessment(data.assessment);

  // A light rerun shouldn't silently hide a richer full assessment — offer it.
  let fullAvailable = false;
  if (!mode && data.mode === 'light') {
    const { count } = await supabase
      .from('store_assessments')
      .select('id', { count: 'exact', head: true })
      .eq('store_slug', slug)
      .eq('mode', 'full');
    fullAvailable = (count ?? 0) > 0;
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <Link href="/arbitrage/store-assessment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All store assessments
        </Link>
        {fullAvailable && (
          <Link href={`/arbitrage/store-assessment/${encodeURIComponent(slug)}?mode=full`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Showing latest (light) run — view latest full assessment
          </Link>
        )}
        {mode && (
          <Link href={`/arbitrage/store-assessment/${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Showing latest {mode} run — view latest overall
          </Link>
        )}
      </div>
      <AssessmentDetail a={assessment} />
    </div>
  );
}
