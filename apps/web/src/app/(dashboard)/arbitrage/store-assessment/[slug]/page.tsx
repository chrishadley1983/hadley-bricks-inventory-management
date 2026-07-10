import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AssessmentDetail, type RunHistoryEntry } from '@/components/features/store-assessment/AssessmentView';
import { normalizeAssessment } from '@/lib/bl-store-assessment/normalize';
import { saFonts } from '@/components/features/store-assessment/fonts';

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

  // Run history for the trend strip (newest first, small and cheap).
  const { data: historyRows } = await supabase
    .from('store_assessments')
    .select('scanned_at,mode,grade,verdict,buyable_lots,buyable_net_gbp,buyable_fresh_lots,median_ask_vs_market')
    .eq('store_slug', slug)
    .order('scanned_at', { ascending: false })
    .limit(8);
  const history: RunHistoryEntry[] = (historyRows ?? []).map((h) => ({
    scannedAt: h.scanned_at as string,
    mode: h.mode as string,
    grade: h.grade == null ? null : Number(h.grade),
    verdict: (h.verdict as string) ?? null,
    buyableLots: h.buyable_lots as number | null,
    buyableNetGbp: h.buyable_net_gbp == null ? null : Number(h.buyable_net_gbp),
    buyableFreshLots: h.buyable_fresh_lots as number | null,
    medianAskVsMarket: h.median_ask_vs_market == null ? null : Number(h.median_ask_vs_market),
  }));

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
    <div className={`${saFonts} space-y-5 p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/arbitrage/store-assessment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="h-4 w-4" /> Store radar
        </Link>
        {fullAvailable && (
          <Link href={`/arbitrage/store-assessment/${encodeURIComponent(slug)}?mode=full`} className="text-sm text-muted-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
            <span className="hidden sm:inline">Showing latest (light) run — </span>view latest full assessment
          </Link>
        )}
        {mode && (
          <Link href={`/arbitrage/store-assessment/${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
            <span className="hidden sm:inline">Showing latest {mode} run — </span>view latest overall
          </Link>
        )}
      </div>
      <AssessmentDetail a={assessment} history={history} />
    </div>
  );
}
