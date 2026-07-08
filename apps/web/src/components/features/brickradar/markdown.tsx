'use client';

import { Fragment, type ReactNode } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * Minimal markdown → React renderer for the pg-* scripts' report_md output
 * (headings, bold/italic/inline-code, bullet lists, pipe tables, paragraphs).
 * No markdown dependency exists in package.json (checked) — this covers exactly
 * the subset those scripts emit (see apps/web/scripts/pg/pg-digest.ts and
 * pg-own-store-audit.ts), it is not a general-purpose parser.
 */

function renderInline(text: string): ReactNode {
  // Split on **bold**, _italic_, `code` — order matters (bold before single-char italic).
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g).filter((t) => t.length > 0);
  return tokens.map((tok, i) => {
    if (tok.startsWith('**') && tok.endsWith('**')) {
      return <strong key={i}>{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith('`') && tok.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('_') && tok.endsWith('_') && tok.length > 2) {
      return (
        <em key={i} className="text-muted-foreground">
          {tok.slice(1, -1)}
        </em>
      );
    }
    return <Fragment key={i}>{tok}</Fragment>;
  });
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(line) && line.includes('-');
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function MiniMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Table: header row + separator row
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      const bodyRows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyRows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {header.map((h, hi) => (
                  <TableHead key={hi} className={hi > 0 ? 'text-right' : ''}>
                    {renderInline(h)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bodyRows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => (
                    <TableCell key={ci} className={ci > 0 ? 'text-right font-mono text-xs' : 'text-xs'}>
                      {renderInline(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
      continue;
    }

    // Headings
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = renderInline(heading[2]);
      if (level === 1) blocks.push(<h3 key={key++} className="mt-4 text-base font-semibold first:mt-0">{text}</h3>);
      else if (level === 2) blocks.push(<h4 key={key++} className="mt-3 text-sm font-semibold first:mt-0">{text}</h4>);
      else blocks.push(<h5 key={key++} className="mt-2 text-sm font-medium text-muted-foreground">{text}</h5>);
      i++;
      continue;
    }

    // Bullet list
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 list-disc space-y-0.5 pl-5 text-sm">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Paragraph — collect contiguous non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^-\s+/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('|')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p key={key++} className="text-sm leading-relaxed">
          {renderInline(paraLines.join(' '))}
        </p>
      );
    } else {
      i++;
    }
  }

  return <div className="space-y-1">{blocks}</div>;
}

/** Collapsed-by-default markdown report block — used everywhere a report_md is shown. */
export function ReportMarkdownCollapsible({
  markdown,
  label = 'Full report',
  defaultOpen = false,
}: {
  markdown: string;
  label?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50">
        <FileText className="h-3.5 w-3.5" />
        {label}
        <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="rounded-md border border-t-0 px-4 py-3">
        <MiniMarkdown markdown={markdown} />
      </CollapsibleContent>
    </Collapsible>
  );
}
