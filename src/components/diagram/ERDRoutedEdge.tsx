import { createContext, useContext, useMemo } from 'react';
import { BaseEdge, Position, useReactFlow, type EdgeProps, type Node } from '@xyflow/react';
import { edgeRoutingObstacles, routeErdEdge, type RouteObstacle } from '@/lib/erd-routing';
import { tableSize } from '@/lib/erd-geometry';
import type { Entity } from '@/types';

export const ERDRoutingContext = createContext<RouteObstacle[]>([]);

export function ERDRoutedEdge(props: EdgeProps) {
  const tables = useContext(ERDRoutingContext);
  const { getInternalNode } = useReactFlow<Node<Entity>>();
  const points = useMemo(() => {
    const endpoints = [getInternalNode(props.source), getInternalNode(props.target)].flatMap(node => node
      ? [{ id: node.id, ...node.internals.positionAbsolute, ...tableSize(node) }] : []);
    // Endpoint coordinates and their table bounds must come from the same live frame.
    const obstacles = edgeRoutingObstacles(tables, endpoints);
    return routeErdEdge(
      { x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY },
      props.sourcePosition === Position.Right, props.targetPosition === Position.Right, obstacles,
    );
  }, [props.source, props.target, props.sourceX, props.sourceY, props.targetX, props.targetY, props.sourcePosition, props.targetPosition, tables, getInternalNode]);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const middle = points[Math.floor(points.length / 2)];
  return <BaseEdge id={props.id} path={path} markerStart={props.markerStart} markerEnd={props.markerEnd}
    style={props.style} interactionWidth={props.interactionWidth} label={props.label} labelX={middle.x} labelY={middle.y}
    labelStyle={props.labelStyle} labelShowBg={props.labelShowBg} labelBgStyle={props.labelBgStyle} />;
}
