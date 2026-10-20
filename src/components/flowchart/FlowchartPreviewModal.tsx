import { useMemo, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FlowchartNodeData } from '../FlowchartNode';
import { FlowchartCanvasPreview, FlowchartComparison } from './FlowchartCanvasPreview';
import { appendFlowchart, replaceFlowchartGroup, type FlowchartCanvas } from '@/lib/flowchart-preview';

interface FlowchartPreviewModalProps {
  nodes: Node<FlowchartNodeData>[];
  edges: Edge[];
  onConfirm: (canvas: FlowchartCanvas) => void;
  onCancel: () => void;
  confirmLabel?: string;
  mode?: 'append' | 'replace' | 'insert';
  canvasGroups?: string[];
  existingNodes?: Node<FlowchartNodeData>[];
  existingEdges?: Edge[];
}

export function FlowchartPreviewModal({
  nodes, edges, onConfirm, onCancel, confirmLabel = 'Confirm Append', mode = 'append',
  canvasGroups = [], existingNodes = [], existingEdges = [],
}: FlowchartPreviewModalProps) {
  const [replaceGroup, setReplaceGroup] = useState('');
  const [before] = useState<FlowchartCanvas>(() => ({ nodes: existingNodes, edges: existingEdges }));
  const after = useMemo(() => {
    const incoming = { nodes, edges };
    if (mode === 'append') return appendFlowchart(before, incoming);
    if (mode === 'replace' && replaceGroup) return replaceFlowchartGroup(before, incoming, replaceGroup);
    return incoming;
  }, [before, nodes, edges, mode, replaceGroup]);

  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent size="4xl" className="max-h-[92dvh]">
      <DialogHeader>
        <DialogTitle>Preview Flowchart Changes</DialogTitle>
        <DialogDescription>Review the shapes and connectors before applying changes. Pan and zoom to inspect each flow.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className={before.nodes.length ? 'grid grid-cols-1 gap-4 lg:grid-cols-2' : 'grid grid-cols-1'}>
          {before.nodes.length > 0 && <FlowchartCanvasPreview canvas={before} title="Current canvas" />}
          <FlowchartCanvasPreview key={replaceGroup} canvas={after} title="After applying AI" />
        </div>
        <FlowchartComparison before={before} after={after} />
      </DialogBody>
      <DialogFooter className="flex-wrap gap-3">
        {mode === 'replace' && canvasGroups.length > 0 && <Select value={replaceGroup} onValueChange={value => setReplaceGroup(value ?? '')}>
          <SelectTrigger className="mr-auto w-52" aria-label="Replacement scope"><SelectValue>{replaceGroup || 'All symbols'}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="">All symbols</SelectItem>{canvasGroups.map(group => <SelectItem key={group} value={group}>{group}</SelectItem>)}</SelectContent>
        </Select>}
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onConfirm(after)}>{replaceGroup ? 'Replace Group' : confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
