'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { InfoTip } from './InfoTip';

/** Section 7 — per-tuple drill-down search, routing to /brickradar/tuple/[type]/[no]/[colour]. */
export function TupleSearchCard() {
  const router = useRouter();
  const [itemType, setItemType] = useState('P');
  const [itemNo, setItemNo] = useState('');
  const [colourId, setColourId] = useState('0');

  const disabled = itemNo.trim().length === 0;

  function go() {
    if (disabled) return;
    const no = encodeURIComponent(itemNo.trim());
    const colour = itemType === 'P' ? colourId.trim() || '0' : '0';
    router.push(`/brickradar/tuple/${itemType}/${no}/${colour}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-4 w-4" />
          Tuple lookup
          <InfoTip text="A tuple is one (item type, item number, colour) identity — e.g. Part 3001 in Black. This jumps straight to its drill-down." />
        </CardTitle>
        <CardDescription>
          Look up any (item type, item number, colour) tuple — joins the L1 worldwide summary, L3 UK price-guide
          detail, and part-out value for a full identity view, including the sold-price histogram against the £0.0699
          Bricqer floor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tuple-type">Type</Label>
            <Select value={itemType} onValueChange={setItemType}>
              <SelectTrigger id="tuple-type" className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="P">Part</SelectItem>
                <SelectItem value="S">Set</SelectItem>
                <SelectItem value="M">Minifig</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tuple-no">Item number</Label>
            <Input
              id="tuple-no"
              value={itemNo}
              onChange={(e) => setItemNo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder={itemType === 'S' ? 'e.g. 75192-1' : itemType === 'M' ? 'e.g. sw0001a' : 'e.g. 3001'}
              className="w-[180px]"
            />
          </div>
          {itemType === 'P' && (
            <div className="space-y-1.5">
              <Label htmlFor="tuple-colour">Colour ID</Label>
              <Input
                id="tuple-colour"
                value={colourId}
                onChange={(e) => setColourId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && go()}
                placeholder="0"
                className="w-[100px]"
              />
            </div>
          )}
          <Button onClick={go} disabled={disabled}>
            <Search className="mr-1.5 h-4 w-4" />
            Look up
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
