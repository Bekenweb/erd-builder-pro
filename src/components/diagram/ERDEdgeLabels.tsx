import { createContext, useMemo, type ReactNode } from 'react';
import { useReactFlow, type Node, type Edge } from '@xyflow/react';
import { ConnectionMode, getEdgePosition, Position } from '@xyflow/system';
import type { Entity } from '@/types';
import { placeErdLabels, type LabelAnchor, type LabelRoute } from '@/lib/erd-edge-labels';
import { routeErdEdge, type RouteObstacle } from '@/lib/erd-routing';

export const ERDEdgeLabelsContext = createContext<{ anchors: Map<string, LabelAnchor>; activeId: string | null }>({ anchors: new Map(), activeId: null });

export function ERDEdgeLabels({ nodes, edges, tables, activeId, children }: {
  nodes: Node<Entity>[]; edges: Edge[]; tables: RouteObstacle[]; activeId: string | null; children: ReactNode;
}) {
  const { getInternalNode } = useReactFlow<Node<Entity>>();
  const anchors = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const internal = (id: string) => {
      const current = getInternalNode(id), settled = byId.get(id);
      return current && settled ? { ...current, internals: { ...current.internals, positionAbsolute: settled.position } } : undefined;
    };
    const routes: LabelRoute[] = edges.flatMap(edge => {
      if (edge.label === undefined || edge.label === null || edge.label === '') return [];
      const sourceNode = internal(edge.source), targetNode = internal(edge.target);
      if (!sourceNode || !targetNode) return [];
      const endpoints = getEdgePosition({ id: edge.id, sourceNode, targetNode, sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null, connectionMode: ConnectionMode.Strict });
      if (!endpoints) return [];
      return [{ id: edge.id, label: String(edge.label), points: routeErdEdge(
        { x: endpoints.sourceX, y: endpoints.sourceY }, { x: endpoints.targetX, y: endpoints.targetY },
        endpoints.sourcePosition === Position.Right, endpoints.targetPosition === Position.Right, tables,
      ) }];
    });
    return placeErdLabels(routes, tables);
  }, [nodes, edges, tables, getInternalNode]);
  const value = useMemo(() => ({ anchors, activeId }), [anchors, activeId]);
  return <ERDEdgeLabelsContext.Provider value={value}>{children}</ERDEdgeLabelsContext.Provider>;
}
