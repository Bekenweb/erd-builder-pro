import type { Edge, Node } from '@xyflow/react';
import type { FlowchartNodeData } from '@/components/FlowchartNode';

/** Persisted imports can have numeric or missing edge IDs; React Flow requires strings. */
export function normalizeFlowchartCanvas(nodes: Node<FlowchartNodeData>[], edges: Edge[]) {
  const normalizedNodes = nodes.map(node => ({ ...node, id: String(node.id) }));
  const ids = new Set(normalizedNodes.map(node => node.id));
  const seen = new Set<string>();
  const normalizedEdges = edges.filter(edge => ids.has(String(edge.source)) && ids.has(String(edge.target))).map((edge, index) => {
    let id = String(edge.id ?? `connector-${index}`);
    while (seen.has(id)) id = `${id}-${index}`;
    seen.add(id);
    return { ...edge, id, source: String(edge.source), target: String(edge.target) };
  });
  return { nodes: normalizedNodes, edges: normalizedEdges };
}
