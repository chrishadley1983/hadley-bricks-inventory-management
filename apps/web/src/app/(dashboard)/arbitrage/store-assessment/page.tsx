import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Store } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VerdictBadge } from '@/components/features/store-assessment/AssessmentView';
import type { Verdict } from '@/lib/bl-store-assessment/types';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  scanned_at: string;
  store_slug: string;
  store_name: string | null;
  store_country: string | null;
  mode: string;
  grade: number | null;
  verdict: string | null;
  total_lots: number | null;
  total_value: number | null;
  median_ask_vs_uk: number | null;
  buyable_lots: number | null;
  buyable_net_gbp: number | null;
  magnet_lots: number | null;
  feedback_score: number | null;
}

const gbp = (n: number | null) => (n == null ? '—' : `£${Number(n).toFixed(0)}`);

export default async function StoreAssessmentListPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase
    .from('store_assessments')
    .select('id,scanned_at,store_slug,store_name,store_country,mode,grade,verdict,total_lots,total_value,median_ask_vs_uk,buyable_lots,buyable_net_gbp,magnet_lots,feedback_score')
    .order('scanned_at', { ascending: false })
    .limit(300);

  const rows = (data ?? []) as Row[];
  // Latest assessment per store.
  const latest = new Map<string, Row>();
  for (const r of rows) if (!latest.has(r.store_slug)) latest.set(r.store_slug, r);
  const stores = [...latest.values()].sort((a, b) => (b.grade ?? -1) - (a.grade ?? -1));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Store className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">Store Assessment</h1>
          <p className="text-sm text-muted-foreground">External BrickLink sellers scored as arbitrage targets — the &quot;assess&quot; lens of the BL Arbitrage skill.</p>
        </div>
      </div>

      {stores.length === 0 ? (
        <Card>
          <CardHeader><CardTitle>No assessments yet</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Run the assess lens to score a store:
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs">cd apps/web &amp;&amp; npx tsx scripts/store-assessment.ts --store-slug=&lt;name&gt; [--mode=full]</pre>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Assessed stores ({stores.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Store</TableHead>
                    <TableHead className="text-right">Grade</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead className="text-right">Lots</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Prices vs UK</TableHead>
                    <TableHead className="text-right">Buyable</TableHead>
                    <TableHead className="text-right">Proj. net</TableHead>
                    <TableHead className="text-right">Magnets</TableHead>
                    <TableHead className="text-right">Scanned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stores.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/arbitrage/store-assessment/${encodeURIComponent(r.store_slug)}`} className="font-medium hover:underline">
                          {r.store_name ?? r.store_slug}
                        </Link>
                        <div className="text-xs text-muted-foreground">{r.store_country ?? ''} · {r.mode}</div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{r.grade ?? '—'}</TableCell>
                      <TableCell>{r.verdict ? <VerdictBadge label={r.verdict as Verdict['label']} /> : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.total_lots?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(r.total_value)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.median_ask_vs_uk != null ? `${Math.round(r.median_ask_vs_uk * 100)}%` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.buyable_lots?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(r.buyable_net_gbp)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.magnet_lots?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{r.scanned_at.slice(0, 10)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
