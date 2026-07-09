import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AssessmentDetail } from '@/components/features/store-assessment/AssessmentView';
import type { StoreAssessment } from '@/lib/bl-store-assessment/types';

export const dynamic = 'force-dynamic';

export default async function StoreAssessmentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase
    .from('store_assessments')
    .select('assessment,scanned_at')
    .eq('store_slug', slug)
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.assessment) notFound();
  const assessment = data.assessment as unknown as StoreAssessment;

  return (
    <div className="space-y-4 p-6">
      <Link href="/arbitrage/store-assessment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> All store assessments
      </Link>
      <AssessmentDetail a={assessment} />
    </div>
  );
}
