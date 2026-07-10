import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardList, TrendingUp, TrendingDown, PackageX, PackageSearch, Boxes } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { ReportMarkdownCollapsible } from './markdown';
import { InfoTip } from './InfoTip';
import { STATUS_TEXT } from './chart-colors';
import type { ReportRow, OwnStoreAuditSummary, DigestSummary } from './types';

function MiniStat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: number | string; tone?: 'good' | 'warn' | 'serious' }) {
  return (
    <div className="flex items-center gap-2 rounded-md border p-2.5">
      <Icon className={`h-4 w-4 shrink-0 ${tone ? STATUS_TEXT[tone] : 'text-muted-foreground'}`} />
      <div>
        <div className={`text-sm font-semibold tabular-nums ${tone ? STATUS_TEXT[tone] : ''}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function OwnStoreAuditCard({ report }: { report: ReportRow | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageSearch className="h-4 w-4" />
          Own-store audit
          <InfoTip text="Automated scan comparing our own live listings against the market — flags overpriced, underpriced, dead-stock, and missing-restock lots." />
        </CardTitle>
        <CardDescription>
          {report ? `${report.subject ?? 'latest run'} — ${formatDate(report.generated_at)}` : 'Overpriced/underpriced/dead-stock/missing-restock scan of our own listings vs the market.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!report ? (
          <p className="text-sm text-muted-foreground">
            No own-store-audit run recorded yet — run{' '}
            <code className="text-xs">npx tsx scripts/pg/pg-own-store-audit.ts</code>.
          </p>
        ) : (
          <>
            {(() => {
              const s = report.summary as unknown as OwnStoreAuditSummary;
              return (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  <MiniStat icon={Boxes} label="Lots audited" value={s.lotsAudited?.toLocaleString?.() ?? s.lotsAudited} />
                  <MiniStat icon={TrendingUp} label="Overpriced" value={s.overpricedCount} tone={s.overpricedCount > 0 ? 'warn' : 'good'} />
                  <MiniStat icon={TrendingDown} label="Underpriced" value={s.underpricedCount} tone={s.underpricedCount > 0 ? 'warn' : 'good'} />
                  <MiniStat icon={PackageX} label="Dead stock" value={s.deadStockCount} tone={s.deadStockCount > 0 ? 'warn' : 'good'} />
                  <MiniStat icon={ClipboardList} label="Missing restock" value={s.missingRestockCount} />
                </div>
              );
            })()}
            <ReportMarkdownCollapsible markdown={report.report_md} label="Full audit report" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DigestCard({ report }: { report: ReportRow | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          Weekly digest
          <InfoTip text="Weekly roll-up of STR risers/fallers, fig movers, and overall coverage/freshness health." />
        </CardTitle>
        <CardDescription>
          {report ? `${report.subject ?? 'latest run'} — ${formatDate(report.generated_at)}` : 'STR risers/fallers, fig movers, and coverage health — pg-digest.ts weekly run.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!report ? (
          <p className="text-sm text-muted-foreground">
            No digest run recorded yet — run <code className="text-xs">npx tsx scripts/pg/pg-digest.ts</code>.
          </p>
        ) : (
          <>
            {(() => {
              const s = report.summary as unknown as DigestSummary;
              return (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <MiniStat icon={TrendingUp} label="Risers" value={s.risersCount} tone="good" />
                  <MiniStat icon={TrendingDown} label="Fallers" value={s.fallersCount} tone="serious" />
                  <MiniStat icon={Boxes} label="Fig movers" value={s.figMoversCount} />
                  <MiniStat icon={PackageSearch} label="L1 total" value={s.l1Total?.toLocaleString?.() ?? s.l1Total} />
                  <MiniStat icon={ClipboardList} label="Active tier" value={s.activeTierCount?.toLocaleString?.() ?? s.activeTierCount} />
                  <MiniStat
                    icon={ClipboardList}
                    label="Within 28d"
                    value={`${Number(s.activeWithin28dPct).toFixed(0)}%`}
                    tone={Number(s.activeWithin28dPct) >= 90 ? 'good' : Number(s.activeWithin28dPct) >= 70 ? 'warn' : 'serious'}
                  />
                  <MiniStat icon={ClipboardList} label="Past due" value={s.pastDueCount} tone={s.pastDueCount > 0 ? 'warn' : 'good'} />
                </div>
              );
            })()}
            <ReportMarkdownCollapsible markdown={report.report_md} label="Full digest report" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportsSection({
  ownStoreAudit,
  digest,
}: {
  ownStoreAudit: ReportRow | null;
  digest: ReportRow | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <OwnStoreAuditCard report={ownStoreAudit} />
      <DigestCard report={digest} />
    </div>
  );
}
