'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SetCheckSession, SetCheckProgress, SetCheckPart } from '@/types/scanner';

interface SetCheckExportButtonProps {
  session: SetCheckSession;
  progress: SetCheckProgress[];
}

/**
 * Generates and downloads a BrickLink Mass Upload XML file for missing parts.
 * Matches the format produced by the CLI's export_bricklink_xml method.
 */
export function SetCheckExportButton({ session, progress }: SetCheckExportButtonProps) {
  const missing = progress.filter((p) => !p.is_spare && p.found_qty < p.expected_qty);

  function handleExport() {
    if (missing.length === 0) return;

    // Build a lookup from part_num to bl_color_id from parts_json
    const blColorMap = new Map<string, number | null>();
    for (const part of session.parts_json as SetCheckPart[]) {
      const key = `${part.part_num}:${part.color_id}`;
      blColorMap.set(key, part.bl_color_id ?? null);
    }

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="utf-8"?>');
    lines.push('<INVENTORY>');

    for (const entry of missing) {
      const needed = entry.expected_qty - entry.found_qty;
      const blColorId = blColorMap.get(`${entry.part_num}:${entry.color_id}`);
      lines.push('  <ITEM>');
      lines.push('    <ITEMTYPE>P</ITEMTYPE>');
      lines.push(`    <ITEMID>${entry.part_num}</ITEMID>`);
      if (blColorId != null) {
        lines.push(`    <COLOR>${blColorId}</COLOR>`);
      }
      lines.push(`    <MINQTY>${needed}</MINQTY>`);
      lines.push('  </ITEM>');
    }

    lines.push('</INVENTORY>');

    const xml = lines.join('\n');
    const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `set-check-${session.set_num}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={missing.length === 0}
      title={
        missing.length === 0
          ? 'No missing parts to export'
          : `Export ${missing.length} missing part type(s) to BrickLink XML`
      }
    >
      <Download className="h-4 w-4 mr-2" />
      Export BrickLink XML
      {missing.length > 0 && (
        <span className="ml-1 text-muted-foreground">({missing.length})</span>
      )}
    </Button>
  );
}
