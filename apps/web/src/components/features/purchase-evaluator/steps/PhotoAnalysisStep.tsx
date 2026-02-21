'use client';

import * as React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Edit2,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Package,
  User,
  Puzzle,
  HelpCircle,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
// Collapsible components imported for potential future use
// import {
//   Collapsible,
//   CollapsibleContent,
//   CollapsibleTrigger,
// } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type {
  PhotoAnalysisResult,
  PhotoAnalysisItem,
  PhotoItemType,
  BoxCondition,
  SealStatus,
} from '@/lib/purchase-evaluator/photo-types';
import {
  getItemTypeLabel,
  getBoxConditionColor,
  getConfidenceColor,
  formatConfidence,
  createEmptyPhotoAnalysisItem,
} from '@/lib/purchase-evaluator/photo-types';

// ============================================
// Types
// ============================================

interface PhotoAnalysisStepProps {
  result: PhotoAnalysisResult | null;
  items: PhotoAnalysisItem[];
  onItemsChange: (items: PhotoAnalysisItem[]) => void;
  targetMarginPercent: number;
  defaultPlatform: string;
  onProceed: () => void;
  onBack: () => void;
  isLoading?: boolean;
}

// ============================================
// Helper Components
// ============================================

function ItemTypeIcon({ type }: { type: PhotoItemType }) {
  const icons: Record<PhotoItemType, React.ReactNode> = {
    set: <Package className="h-4 w-4" />,
    minifig: <User className="h-4 w-4" />,
    parts_lot: <Puzzle className="h-4 w-4" />,
    non_lego: <XCircle className="h-4 w-4" />,
    unknown: <HelpCircle className="h-4 w-4" />,
  };
  return <>{icons[type]}</>;
}

function ConfidenceIndicator({
  confidence,
  modelsAgree,
}: {
  confidence: number;
  modelsAgree: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('font-medium', getConfidenceColor(confidence))}>
        {formatConfidence(confidence)}
      </span>
      {modelsAgree ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
      )}
    </div>
  );
}

// ============================================
// Edit Item Dialog
// ============================================

interface EditItemDialogProps {
  item: PhotoAnalysisItem | null;
  open: boolean;
  onClose: () => void;
  onSave: (itemId: string, updates: Partial<PhotoAnalysisItem>) => void;
}

function EditItemDialog({ item, open, onClose, onSave }: EditItemDialogProps) {
  const [formData, setFormData] = React.useState<Partial<PhotoAnalysisItem>>({});

  React.useEffect(() => {
    if (item) {
      setFormData({
        setNumber: item.setNumber,
        setName: item.setName,
        condition: item.condition,
        boxCondition: item.boxCondition,
        sealStatus: item.sealStatus,
        quantity: item.quantity,
      });
    }
  }, [item]);

  const handleSave = () => {
    if (item) {
      onSave(item.id, formData);
      onClose();
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle>
          <DialogDescription>
            Correct any identification errors from the AI analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Set Number</Label>
              <Input
                value={formData.setNumber || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, setNumber: e.target.value || null }))
                }
                placeholder="e.g., 75192"
              />
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min={1}
                value={formData.quantity || 1}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    quantity: parseInt(e.target.value) || 1,
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Set Name</Label>
            <Input
              value={formData.setName || ''}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, setName: e.target.value || null }))
              }
              placeholder="e.g., Millennium Falcon"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select
                value={formData.condition}
                onValueChange={(v: string) =>
                  setFormData((prev) => ({ ...prev, condition: v as 'New' | 'Used' }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Used">Used</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Box Condition</Label>
              <Select
                value={formData.boxCondition || 'none'}
                onValueChange={(v: string) =>
                  setFormData((prev) => ({
                    ...prev,
                    boxCondition: v === 'none' ? null : (v as BoxCondition),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">N/A</SelectItem>
                  <SelectItem value="Mint">Mint</SelectItem>
                  <SelectItem value="Excellent">Excellent</SelectItem>
                  <SelectItem value="Good">Good</SelectItem>
                  <SelectItem value="Fair">Fair</SelectItem>
                  <SelectItem value="Poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Seal Status</Label>
            <Select
              value={formData.sealStatus}
              onValueChange={(v: string) =>
                setFormData((prev) => ({ ...prev, sealStatus: v as SealStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Factory Sealed">Factory Sealed</SelectItem>
                <SelectItem value="Resealed">Resealed</SelectItem>
                <SelectItem value="Open Box">Open Box</SelectItem>
                <SelectItem value="Unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Add Item Dialog
// ============================================

interface AddItemDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (item: Omit<PhotoAnalysisItem, 'id'>) => void;
}

function AddItemDialog({ open, onClose, onAdd }: AddItemDialogProps) {
  const [itemType, setItemType] = React.useState<PhotoItemType>('set');
  const [setNumber, setSetNumber] = React.useState('');
  const [setName, setSetName] = React.useState('');
  const [condition, setCondition] = React.useState<'New' | 'Used'>('New');
  const [quantity, setQuantity] = React.useState(1);

  const handleAdd = () => {
    const newItem = createEmptyPhotoAnalysisItem(itemType);
    onAdd({
      ...newItem,
      setNumber: setNumber || null,
      setName: setName || null,
      condition,
      quantity,
      needsReview: false,
      reviewReason: null,
    });

    // Reset form
    setItemType('set');
    setSetNumber('');
    setSetName('');
    setCondition('New');
    setQuantity(1);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Item Manually</DialogTitle>
          <DialogDescription>
            Add an item that wasn&apos;t detected by the AI analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Item Type</Label>
            <Select value={itemType} onValueChange={(v: string) => setItemType(v as PhotoItemType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="set">LEGO Set</SelectItem>
                <SelectItem value="minifig">Minifigure</SelectItem>
                <SelectItem value="parts_lot">Parts Lot</SelectItem>
                <SelectItem value="non_lego">Non-LEGO</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {itemType === 'set' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Set Number</Label>
                  <Input
                    value={setNumber}
                    onChange={(e) => setSetNumber(e.target.value)}
                    placeholder="e.g., 75192"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Set Name</Label>
                <Input
                  value={setName}
                  onChange={(e) => setSetName(e.target.value)}
                  placeholder="e.g., Millennium Falcon"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>Condition</Label>
            <Select
              value={condition}
              onValueChange={(v: string) => setCondition(v as 'New' | 'Used')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="New">New</SelectItem>
                <SelectItem value="Used">Used</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd}>Add Item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Main Component
// ============================================

export function PhotoAnalysisStep({
  result,
  items,
  onItemsChange,
  targetMarginPercent: _targetMarginPercent,
  defaultPlatform: _defaultPlatform,
  onProceed,
  onBack,
  isLoading,
}: PhotoAnalysisStepProps) {
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = React.useState<PhotoAnalysisItem | null>(null);
  const [showAddDialog, setShowAddDialog] = React.useState(false);

  // Handler functions using items state
  const onUpdateItem = (itemId: string, updates: Partial<PhotoAnalysisItem>) => {
    onItemsChange(items.map((item) => (item.id === itemId ? { ...item, ...updates } : item)));
  };

  const onRemoveItem = (itemId: string) => {
    onItemsChange(items.filter((item) => item.id !== itemId));
  };

  const onAddItem = (item: Omit<PhotoAnalysisItem, 'id'>) => {
    const newItem: PhotoAnalysisItem = {
      ...item,
      id: `manual-${Date.now()}`,
    };
    onItemsChange([...items, newItem]);
  };

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const reviewCount = items.filter((i) => i.needsReview).length;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Analysis Results</CardTitle>
          <CardDescription>
            {result
              ? `Found ${items.length} item(s) in ${result.processingTimeMs}ms using ${result.modelsUsed.join(', ')}.`
              : `Found ${items.length} item(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Warnings */}
          {result && result.warnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Attention Required</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {result.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Overall Notes */}
          {result && result.overallNotes && (
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-sm text-muted-foreground">{result.overallNotes}</p>
            </div>
          )}

          {/* Stats */}
          <div className="flex gap-4 text-sm flex-wrap">
            {result && (
              <Badge variant="outline">
                Confidence: {formatConfidence(result.analysisConfidence)}
              </Badge>
            )}
            {reviewCount > 0 && <Badge variant="destructive">{reviewCount} need review</Badge>}
            {result?.wasChunked && (
              <Badge variant="secondary">
                Smart chunking: {result.chunkCount} regions analyzed
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Identified Items</CardTitle>
            <CardDescription>
              Review and correct the AI&apos;s identifications as needed.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <React.Fragment key={item.id}>
                  <TableRow
                    className={cn(item.needsReview && 'bg-yellow-50 dark:bg-yellow-950/20')}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ItemTypeIcon type={item.itemType} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {item.setNumber ? `#${item.setNumber}` : getItemTypeLabel(item.itemType)}
                        </p>
                        {item.setName && (
                          <p className="text-sm text-muted-foreground">{item.setName}</p>
                        )}
                        {item.quantity > 1 && (
                          <Badge variant="secondary" className="mt-1">
                            Qty: {item.quantity}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={item.condition === 'New' ? 'default' : 'secondary'}>
                          {item.condition}
                        </Badge>
                        {item.boxCondition && (
                          <Badge className={cn('ml-1', getBoxConditionColor(item.boxCondition))}>
                            {item.boxCondition}
                          </Badge>
                        )}
                        {item.sealStatus !== 'Unknown' && (
                          <p className="text-xs text-muted-foreground mt-1">{item.sealStatus}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ConfidenceIndicator
                        confidence={item.confidenceScore}
                        modelsAgree={item.modelsAgree}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => toggleExpanded(item.id)}>
                          {expandedItems.has(item.id) ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setEditingItem(item)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => onRemoveItem(item.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded Details */}
                  {expandedItems.has(item.id) && (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/50">
                        <div className="p-4 space-y-3">
                          {/* Review Reason */}
                          {item.needsReview && item.reviewReason && (
                            <Alert variant="destructive" className="py-2">
                              <AlertTriangle className="h-4 w-4" />
                              <AlertDescription>{item.reviewReason}</AlertDescription>
                            </Alert>
                          )}

                          {/* AI Description */}
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">
                              AI Description:
                            </p>
                            <p className="text-sm">{item.rawDescription}</p>
                          </div>

                          {/* Damage Notes */}
                          {item.damageNotes.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Damage Notes:
                              </p>
                              <ul className="text-sm list-disc list-inside">
                                {item.damageNotes.map((note, i) => (
                                  <li key={i}>{note}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Model Results - Enhanced Attribution */}
                          {item.modelIdentifications.length > 0 && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-medium text-muted-foreground">
                                  AI Model Attribution:
                                </p>
                                {item.modelsAgree ? (
                                  <Badge variant="default" className="bg-green-600">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Models Agree
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Models Disagree
                                  </Badge>
                                )}
                              </div>
                              <div className="grid gap-2">
                                {item.modelIdentifications.map((m, i) => (
                                  <div
                                    key={i}
                                    className={cn(
                                      'border rounded-lg p-3 space-y-2',
                                      m.model === 'opus' &&
                                        'border-purple-300 bg-purple-50/50 dark:bg-purple-950/20',
                                      m.model === 'gemini' &&
                                        'border-blue-300 bg-blue-50/50 dark:bg-blue-950/20',
                                      m.model === 'brickognize' &&
                                        'border-orange-300 bg-orange-50/50 dark:bg-orange-950/20'
                                    )}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={cn(
                                            'font-semibold text-sm',
                                            m.model === 'opus' &&
                                              'text-purple-700 dark:text-purple-300',
                                            m.model === 'gemini' &&
                                              'text-blue-700 dark:text-blue-300',
                                            m.model === 'brickognize' &&
                                              'text-orange-700 dark:text-orange-300'
                                          )}
                                        >
                                          {m.model === 'opus' && '🤖 Claude Opus'}
                                          {m.model === 'gemini' && '✨ Google Gemini'}
                                          {m.model === 'brickognize' && '🧱 Brickognize'}
                                        </span>
                                        {i === 0 && (
                                          <Badge variant="secondary" className="text-xs">
                                            Primary
                                          </Badge>
                                        )}
                                      </div>
                                      <span
                                        className={cn(
                                          'font-bold',
                                          getConfidenceColor(m.confidence)
                                        )}
                                      >
                                        {formatConfidence(m.confidence)}
                                      </span>
                                    </div>
                                    <div className="text-sm">
                                      <span className="text-muted-foreground">Identified: </span>
                                      <span className="font-medium">
                                        {m.setNumber ? `#${m.setNumber}` : 'Unable to identify'}
                                        {m.setName && ` - ${m.setName}`}
                                      </span>
                                    </div>
                                    {m.rawResponse && (
                                      <div className="text-xs text-muted-foreground bg-white/50 dark:bg-black/20 p-2 rounded">
                                        <span className="font-medium">Raw: </span>
                                        {m.rawResponse.length > 200
                                          ? `${m.rawResponse.substring(0, 200)}...`
                                          : m.rawResponse}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}

              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No items identified. Click &quot;Add Item&quot; to add items manually.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back to Photos
        </Button>
        <Button onClick={onProceed} disabled={items.length === 0 || isLoading}>
          {isLoading ? 'Processing...' : 'Continue to Lookup'}
        </Button>
      </div>

      {/* Dialogs */}
      <EditItemDialog
        item={editingItem}
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        onSave={onUpdateItem}
      />
      <AddItemDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={onAddItem}
      />
    </div>
  );
}
