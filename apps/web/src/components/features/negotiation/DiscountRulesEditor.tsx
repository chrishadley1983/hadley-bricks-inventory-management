'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { NegotiationDiscountRule } from '@/lib/ebay/negotiation.types';

interface DiscountRulesEditorProps {
  rules?: NegotiationDiscountRule[];
  isLoading?: boolean;
  onCreateRule: (rule: Omit<NegotiationDiscountRule, 'id' | 'userId'>) => Promise<void>;
  onUpdateRule: (id: string, rule: Omit<NegotiationDiscountRule, 'id' | 'userId'>) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
}

interface EditingRule {
  id?: string;
  minScore: number;
  maxScore: number;
  discountPercentage: number;
}

export function DiscountRulesEditor({
  rules,
  isLoading,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
}: DiscountRulesEditorProps) {
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleStartEdit = (rule: NegotiationDiscountRule) => {
    setEditingRule({
      id: rule.id,
      minScore: rule.minScore,
      maxScore: rule.maxScore,
      discountPercentage: rule.discountPercentage,
    });
  };

  const handleStartCreate = () => {
    // Find a gap or suggest next range
    const sortedRules = [...(rules || [])].sort((a, b) => a.minScore - b.minScore);
    let suggestedMin = 0;

    if (sortedRules.length > 0) {
      const lastRule = sortedRules[sortedRules.length - 1];
      suggestedMin = lastRule.maxScore + 1;
    }

    setEditingRule({
      minScore: Math.min(suggestedMin, 100),
      maxScore: Math.min(suggestedMin + 19, 100),
      discountPercentage: 15,
    });
  };

  const handleCancel = () => {
    setEditingRule(null);
  };

  const handleSave = async () => {
    if (!editingRule) return;

    // Validation
    if (editingRule.minScore > editingRule.maxScore) {
      toast({
        title: 'Invalid range',
        description: 'Min score must be less than or equal to max score',
        variant: 'destructive',
      });
      return;
    }

    if (editingRule.discountPercentage < 10 || editingRule.discountPercentage > 50) {
      toast({
        title: 'Invalid discount',
        description: 'Discount must be between 10% and 50%',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingRule.id) {
        await onUpdateRule(editingRule.id, {
          minScore: editingRule.minScore,
          maxScore: editingRule.maxScore,
          discountPercentage: editingRule.discountPercentage,
        });
        toast({ title: 'Rule updated' });
      } else {
        await onCreateRule({
          minScore: editingRule.minScore,
          maxScore: editingRule.maxScore,
          discountPercentage: editingRule.discountPercentage,
        });
        toast({ title: 'Rule created' });
      }
      setEditingRule(null);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save rule',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await onDeleteRule(id);
      toast({ title: 'Rule deleted' });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete rule',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Discount Rules</h4>
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const sortedRules = [...(rules || [])].sort((a, b) => a.minScore - b.minScore);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">Discount Rules</h4>
          <p className="text-xs text-muted-foreground">
            Map score ranges to discount percentages (10-50%)
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleStartCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Add Rule
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Score Range</TableHead>
              <TableHead className="text-right">Discount %</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRules.map((rule) => (
              <TableRow key={rule.id}>
                {editingRule?.id === rule.id ? (
                  <>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={editingRule.minScore}
                          onChange={(e) =>
                            setEditingRule({
                              ...editingRule,
                              minScore: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          className="w-16 h-8"
                        />
                        <span>-</span>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={editingRule.maxScore}
                          onChange={(e) =>
                            setEditingRule({
                              ...editingRule,
                              maxScore: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          className="w-16 h-8"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={10}
                        max={50}
                        value={editingRule.discountPercentage}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            discountPercentage: parseInt(e.target.value, 10) || 10,
                          })
                        }
                        className="w-16 h-8 ml-auto"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleSave}
                          disabled={isSubmitting}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancel}
                          disabled={isSubmitting}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>
                      {rule.minScore} - {rule.maxScore}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {rule.discountPercentage}%
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStartEdit(rule)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(rule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
            {/* New rule row */}
            {editingRule && !editingRule.id && (
              <TableRow>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={editingRule.minScore}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          minScore: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="w-16 h-8"
                    />
                    <span>-</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={editingRule.maxScore}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          maxScore: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="w-16 h-8"
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={10}
                    max={50}
                    value={editingRule.discountPercentage}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        discountPercentage: parseInt(e.target.value, 10) || 10,
                      })
                    }
                    className="w-16 h-8 ml-auto"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleSave}
                      disabled={isSubmitting}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCancel}
                      disabled={isSubmitting}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {sortedRules.length === 0 && !editingRule && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No rules configured. Default rules will be used.
        </p>
      )}
    </div>
  );
}
