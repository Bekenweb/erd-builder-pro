import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, GitBranch, Plus, AlertTriangle } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import { previewFlowchartContent } from '@/components/ai/actions/flowchartActions';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogOverlay,
  DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent,
  SelectItem, SelectGroup, SelectLabel,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useProjectFiles } from './useProjectFiles';
import { PENDING_FLOWCHART_EVENT, PENDING_FLOWCHART_TARGET } from '@/lib/pending-flowchart';
import { FlowchartNodeData } from '@/components/FlowchartNode';
import { FlowchartCanvasPreview, FlowchartComparison } from '@/components/flowchart/FlowchartCanvasPreview';

export interface FlowchartFromJsonDialogProps {
  json: string;
  onClose: () => void;
  flowcharts: any[];
  targetProjectId: string | number | null | undefined;
  flowchartDefaultName?: string;
  handleSidebarFlowchartCreate: (name: string, projectId?: any, options?: { silent?: boolean }) => Promise<any>;
  handleFlowchartSelect: (uid: string) => Promise<any>;
  createSilently?: boolean;
  onCreated?: (flowchart: any, json: string) => void | Promise<void>;
}

export function FlowchartFromJsonDialog({
  json,
  onClose,
  flowcharts: workspaceFlowcharts,
  targetProjectId,
  flowchartDefaultName = 'New Flowchart',
  handleSidebarFlowchartCreate,
  handleFlowchartSelect,
  createSilently = false,
  onCreated,
}: FlowchartFromJsonDialogProps) {
  const flowcharts = useProjectFiles('flowcharts', targetProjectId, workspaceFlowcharts);
  const [mode, setMode] = useState<'create' | 'update' | null>(null);
  const [updateUid, setUpdateUid] = useState<string | null>(null);
  const [existingData, setExistingData] = useState<{ nodes: Node<FlowchartNodeData>[]; edges: Edge[] } | null>(null);
  const [fetchingExisting, setFetchingExisting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // ── Parse new nodes/edges from AI JSON ──
  const newNodes = useMemo(() => {
    if (!json) return [];
    const result = previewFlowchartContent(json);
    return result?.nodes || [];
  }, [json]);

  const newEdges = useMemo(() => {
    if (!json) return [];
    const result = previewFlowchartContent(json);
    return result?.edges || [];
  }, [json]);

  // ── Fetch existing flowchart data for update mode ──
  useEffect(() => {
    if (!updateUid || mode !== 'update') {
      setExistingData(null);
      return;
    }
    let cancelled = false;
    setFetchingExisting(true);
    apiFetch(`/api/flowcharts/${updateUid}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled) return;
        if (!data || !data.data) { setExistingData(null); return; }
        try {
          const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
          const nodes: Node<FlowchartNodeData>[] = (parsed.nodes || []).map((n: any) => ({
            ...n,
            id: n.id,
            type: 'custom',
            position: n.position || { x: 0, y: 0 },
            data: n.data || n,
          }));
          const edges: Edge[] = (parsed.edges || []).map((e: any) => ({
            ...e,
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            label: e.label,
            type: e.type || 'smoothstep',
          }));
          setExistingData({ nodes, edges });
        } catch {
          setExistingData(null);
        }
      })
      .catch(() => { if (!cancelled) setExistingData(null); })
      .finally(() => { if (!cancelled) setFetchingExisting(false); });
    return () => { cancelled = true; };
  }, [updateUid, mode]);

  const incomingCanvas = useMemo(() => ({ nodes: newNodes, edges: newEdges }), [newNodes, newEdges]);

  // ── Create new flowchart ──
  const handleCreate = useCallback(async () => {
    if (!createSilently) localStorage.setItem('pending_create_flowchart_json', json);
    toast.info('Creating new Flowchart...');
    const flowchart = await handleSidebarFlowchartCreate(`Flowchart - ${flowchartDefaultName}`, targetProjectId, { silent: createSilently });
    if (!flowchart) localStorage.removeItem('pending_create_flowchart_json');
    else if (localStorage.getItem('pending_create_flowchart_json')) {
      // Not consumed yet (e.g. a replace-pane prompt is open): bind it to the new file only.
      localStorage.setItem(PENDING_FLOWCHART_TARGET, String(flowchart.uid ?? flowchart.id));
      window.dispatchEvent(new Event(PENDING_FLOWCHART_EVENT));
    }
    if (flowchart) {
      onClose();
      await onCreated?.(flowchart, json);
      return;
    }
    onClose();
  }, [json, handleSidebarFlowchartCreate, targetProjectId, flowchartDefaultName, onClose]);

  // ── Update existing flowchart ──
  const handleUpdate = useCallback(async (uid: string) => {
    localStorage.setItem('pending_update_flowchart_json', json);
    localStorage.setItem(PENDING_FLOWCHART_TARGET, uid);
    toast.info('Review changes in the Flowchart...');
    if (window.location.pathname !== `/flowcharts/${uid}`) await handleFlowchartSelect(uid);
    onClose();
    window.dispatchEvent(new Event(PENDING_FLOWCHART_EVENT));
  }, [json, handleFlowchartSelect, onClose]);

  // ── Filter flowcharts by project ──
  const eligibleFlowcharts = useMemo(() => flowcharts.filter((f: any) => {
    if (targetProjectId == null || targetProjectId === 'none') {
      return f.project_id == null || f.project_id === 'none' || f.project_id === '';
    }
    return String(f.project_id) === String(targetProjectId);
  }), [flowcharts, targetProjectId]);

  const hasNodes = newNodes.length > 0;

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogOverlay />
      <DialogContent size="4xl" showCloseButton>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <GitBranch className="size-4 text-emerald-400" />
            </div>
            <div>
              <DialogTitle>Flowchart from AI</DialogTitle>
              <DialogDescription>
                {mode === 'update'
                  ? 'Select which Flowchart to update'
                  : 'Create a new Flowchart or update an existing one'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-4">
            {/* Action selection */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setMode('create'); setUpdateUid(null); }}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all text-center group ${
                  mode === 'create'
                    ? 'border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                    : 'border-border/60 bg-muted/20 hover:bg-emerald-500/5 hover:border-emerald-500/20'
                }`}
              >
                <Plus className={`size-5 ${mode === 'create' ? 'text-emerald-300' : 'text-emerald-400'}`} />
                <div>
                  <p className="text-xs font-semibold text-foreground">Create New</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">New Flowchart with these symbols</p>
                </div>
              </button>

              <button
                onClick={() => setMode('update')}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all text-center group ${
                  mode === 'update'
                    ? 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30'
                    : 'border-border/60 bg-muted/20 hover:bg-amber-500/5 hover:border-amber-500/20'
                }`}
              >
                <GitBranch className={`size-5 ${mode === 'update' ? 'text-amber-300' : 'text-amber-400'}`} />
                <div>
                  <p className="text-xs font-semibold text-foreground">Update Existing</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Merge or replace an existing Flowchart</p>
                </div>
              </button>
            </div>

            {/* Parse error: flowchart JSON invalid */}
            {json && !hasNodes && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-red-300">Invalid Flowchart JSON</p>
                    <p className="text-[11px] text-red-400/70 mt-1">
                      The JSON could not be parsed. Ensure it contains a valid <code className="bg-red-500/10 px-1 rounded">{'{ "nodes": [...], "edges": [...] }'}</code> structure.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {hasNodes && mode === 'create' && <FlowchartCanvasPreview canvas={incomingCanvas} title="New flowchart" />}

            {/* Preview: Update mode — target selector + diff */}
            {mode === 'update' && (
              <div className="space-y-3 pt-2 border-t border-border/20">
                <label className="text-[11px] font-medium text-muted-foreground">Target Flowchart</label>
                <Select value={updateUid || ''} onValueChange={setUpdateUid}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Choose a Flowchart...">
                      {(val: string | null) => {
                        if (!val) return null;
                        const f = flowcharts.find((f: any) => (f.uid ?? String(f.id)) === val);
                        return f?.title || f?.name || 'Untitled';
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleFlowcharts.length === 0 ? (
                      <div className="px-3 py-4 text-[11px] text-muted-foreground/50 text-center">
                        No Flowcharts in this project
                      </div>
                    ) : (
                      <SelectGroup>
                        <SelectLabel>Flowcharts</SelectLabel>
                        {eligibleFlowcharts.map((f: any) => (
                          <SelectItem key={f.uid ?? f.id} value={f.uid ?? String(f.id)}>
                            <span>{f.title || f.name || 'Untitled'}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>

                {updateUid && fetchingExisting && (
                  <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin mr-2" />
                    Loading existing Flowchart...
                  </div>
                )}

                {updateUid && !fetchingExisting && existingData && <>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <FlowchartCanvasPreview canvas={existingData} title="Current canvas" />
                    <FlowchartCanvasPreview canvas={incomingCanvas} title="After applying AI" />
                  </div>
                  <FlowchartComparison before={existingData} after={incomingCanvas} />
                </>}
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!mode || confirming || !hasNodes || (mode === 'update' && !updateUid)}
            onClick={async () => {
              if (!mode) return;
              setConfirming(true);
              try {
                if (mode === 'create') {
                  await handleCreate();
                } else if (mode === 'update' && updateUid) {
                  await handleUpdate(updateUid);
                }
              } finally {
                setConfirming(false);
              }
            }}
          >
            {confirming ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitBranch className="size-3.5" />
            )}
            {mode === 'create' ? 'Create Flowchart' : 'Update Flowchart'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
