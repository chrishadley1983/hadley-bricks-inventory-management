'use client';

import { Badge } from '@/components/ui/badge';
import type { SetCheckProgress } from '@/types/scanner';

interface SetCheckMissingPartsProps {
  progress: SetCheckProgress[];
}

function ColorSwatch({ rgb }: { rgb?: string }) {
  if (!rgb) return null;
  return (
    <span
      className="inline-block w-3 h-3 rounded-sm border border-border mr-1 align-middle"
      style={{ backgroundColor: `#${rgb}` }}
      aria-hidden="true"
    />
  );
}

export function SetCheckMissingParts({ progress }: SetCheckMissingPartsProps) {
  const missing = progress
    .filter((p) => !p.is_spare && p.found_qty < p.expected_qty)
    .sort((a, b) => {
      // Sort by most needed first, then part number
      const neededA = a.expected_qty - a.found_qty;
      const neededB = b.expected_qty - b.found_qty;
      if (neededB !== neededA) return neededB - neededA;
      return a.part_num.localeCompare(b.part_num);
    });

  if (missing.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No missing parts — set appears complete!
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Part</th>
            <th className="py-2 pr-4 font-medium">Color</th>
            <th className="py-2 pr-4 font-medium text-right">Expected</th>
            <th className="py-2 pr-4 font-medium text-right">Found</th>
            <th className="py-2 font-medium text-right">Needed</th>
          </tr>
        </thead>
        <tbody>
          {missing.map((p) => (
            <tr key={`${p.part_num}-${p.color_id}`} className="border-b last:border-0">
              <td className="py-2 pr-4 font-mono text-xs">{p.part_num}</td>
              <td className="py-2 pr-4">
                <span className="flex items-center gap-1">
                  <ColorSwatch />
                  {p.color_name}
                </span>
              </td>
              <td className="py-2 pr-4 text-right">{p.expected_qty}</td>
              <td className="py-2 pr-4 text-right">{p.found_qty}</td>
              <td className="py-2 text-right">
                <Badge variant="destructive" className="text-xs">
                  {p.expected_qty - p.found_qty}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
