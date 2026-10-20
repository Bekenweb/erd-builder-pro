import { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls } from '@xyflow/react';
import FlowchartNode from '@/components/FlowchartNode';
import { useWorkspace } from '@/providers/WorkspaceContext';
import { autoLayoutFlowchart } from '@/lib/autoLayoutFlowchart';
import { normalizeFlowchartCanvas } from '@/lib/flowchart-canvas';
import { compareFlowcharts, type FlowchartCanvas } from '@/lib/flowchart-preview';

const nodeTypes = { custom: FlowchartNode };

export function FlowchartCanvasPreview({ canvas, title }: { canvas: FlowchartCanvas; title: string }) {
  const { resolvedTheme } = useWorkspace();
  const layout = useMemo(() => {
    const normalized = normalizeFlowchartCanvas(canvas.nodes, canvas.edges);
    const result = autoLayoutFlowchart(normalized.nodes, normalized.edges);
    return { ...result, nodes: result.nodes.map(node => ({ ...node, type: 'custom', selected: false, data: { ...node.data, _readOnly: true, _commentsEnabled: false } })) };
  }, [canvas]);
  return <section aria-label={title} className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background">
    <div className="border-b px-3 py-2 text-sm font-medium">{title}<span className="ml-2 text-xs text-muted-foreground">{layout.nodes.length} shapes · {layout.edges.length} connectors</span></div>
    <div className="relative h-[420px] min-h-64">
      {!layout.nodes.length && <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">Empty canvas</p>}
      <ReactFlowProvider><ReactFlow nodes={layout.nodes} edges={layout.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }} colorMode={resolvedTheme}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesReconnectable={false} deleteKeyCode={null} minZoom={0.08} maxZoom={2.5}>
        <Background color={resolvedTheme === 'dark' ? '#333' : '#ddd'} />
        <Controls showInteractive={false} />
      </ReactFlow></ReactFlowProvider>
    </div>
  </section>;
}

export function FlowchartComparison({ before, after }: { before: FlowchartCanvas; after: FlowchartCanvas }) {
  const changes = useMemo(() => compareFlowcharts(before, after), [before, after]);
  return <section aria-label="Flowchart changes" className="space-y-2">
    <h3 className="text-sm font-medium">Changes ({changes.length})</h3>
    <div className="max-h-40 overflow-y-auto rounded-lg border text-sm">
      {changes.length === 0 ? <p className="p-3 text-muted-foreground">No shape or connector changes.</p> : changes.map((change, i) => <div key={i} className="border-b px-3 py-2 last:border-0">
        <span className="mr-2 font-semibold">{change.status} {change.kind}</span><span>{change.label}</span>
        {change.detail && <p className="break-words text-xs text-muted-foreground">{change.detail}</p>}
      </div>)}
    </div>
  </section>;
}
