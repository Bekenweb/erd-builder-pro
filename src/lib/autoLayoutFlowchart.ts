import { Edge, MarkerType, Node } from '@xyflow/react';
import { FlowchartNodeData } from '@/components/FlowchartNode';

const START_X = 80;
const START_Y = 80;
const MIN_COLUMN_SPACING = 240;
const MIN_ROW_SPACING = 150;
const COLUMN_PADDING = 64;
const ROW_PADDING = 72;

type Side = -1 | 0 | 1;

export interface FlowchartLayoutResult {
  nodes: Node<FlowchartNodeData>[];
  edges: Edge[];
}

function normalizeLabel(label: string | undefined): string {
  return (label || '').trim().toLowerCase();
}

function isStartLike(node: Node<FlowchartNodeData>): boolean {
  const label = normalizeLabel(node.data.label);
  return label.includes('start') || label.includes('begin');
}

function isEndLike(node: Node<FlowchartNodeData>): boolean {
  const label = normalizeLabel(node.data.label);
  return label.includes('end') || label.includes('finish') || label.includes('done') || label.includes('stop');
}

function isErrorLike(node: Node<FlowchartNodeData>): boolean {
  return /error|gagal|tolak|reject|fail|invalid|hentikan|stop/i.test(node.data.label || '');
}

function isDecision(node: Node<FlowchartNodeData>): boolean {
  return node.data.shape === 'diamond';
}

function shapeFootprint(node: Node<FlowchartNodeData>): { width: number; height: number } {
  const labelLen = (node.data.label || '').trim().length;
  const shape = node.data.shape;

  const base = (() => {
    switch (shape) {
      case 'diamond':
        return { width: 130, height: 130, wrap: 12 };
      case 'circle':
        return { width: 110, height: 110, wrap: 10 };
      case 'cloud':
        return { width: 170, height: 96, wrap: 16 };
      case 'database':
        return { width: 150, height: 104, wrap: 16 };
      case 'parallelogram':
        return { width: 170, height: 86, wrap: 16 };
      case 'document':
        return { width: 150, height: 96, wrap: 16 };
      case 'oval':
        return { width: 150, height: 84, wrap: 15 };
      case 'rectangle':
      default:
        return { width: 150, height: 84, wrap: 16 };
    }
  })();

  const extraLines = Math.max(0, Math.ceil(labelLen / base.wrap) - 1);
  const extraHeight = extraLines * 18;
  const extraWidth = shape === 'diamond'
    ? Math.min(48, Math.max(0, labelLen - base.wrap) * 3)
    : Math.min(64, Math.max(0, labelLen - base.wrap * 1.5) * 2.5);

  return {
    width: base.width + extraWidth,
    height: base.height + extraHeight,
  };
}

function getNodeCenter(node: Node<FlowchartNodeData>): { x: number; y: number } {
  const footprint = shapeFootprint(node);
  return {
    x: node.position.x + footprint.width / 2,
    y: node.position.y + footprint.height / 2,
  };
}

function sortChildren(
  parent: Node<FlowchartNodeData>,
  children: string[],
  edgeLabelLookup: Map<string, string>,
  nodeMap: Map<string, Node<FlowchartNodeData>>,
): string[] {
  const ordered = [...children];

  if (isDecision(parent)) {
    ordered.sort((a, b) => {
      const labelA = normalizeLabel(edgeLabelLookup.get(`${parent.id}->${a}`));
      const labelB = normalizeLabel(edgeLabelLookup.get(`${parent.id}->${b}`));
      const aScore = labelA === 'yes' ? 0 : labelA === 'no' ? 1 : 2;
      const bScore = labelB === 'yes' ? 0 : labelB === 'no' ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
      const aNode = nodeMap.get(a);
      const bNode = nodeMap.get(b);
      const aBias = isStartLike(aNode!) ? -1 : isEndLike(aNode!) ? 1 : 0;
      const bBias = isStartLike(bNode!) ? -1 : isEndLike(bNode!) ? 1 : 0;
      if (aBias !== bBias) return aBias - bBias;
      return (aNode?.data.label || '').localeCompare(bNode?.data.label || '');
    });
    return ordered;
  }

  ordered.sort((a, b) => {
    const aNode = nodeMap.get(a);
    const bNode = nodeMap.get(b);
    const aBias = isStartLike(aNode!) ? -1 : isEndLike(aNode!) ? 1 : 0;
    const bBias = isStartLike(bNode!) ? -1 : isEndLike(bNode!) ? 1 : 0;
    if (aBias !== bBias) return aBias - bBias;
    return (aNode?.data.label || '').localeCompare(bNode?.data.label || '');
  });
  return ordered;
}

function searchFreeColumn(
  occupied: Map<number, Set<number>>,
  layer: number,
  preferred: number,
  sideHint: Side,
): number {
  const normalizedPreferred = Math.round(preferred);
  const tryColumn = (col: number): number | null => {
    const cols = occupied.get(layer);
    if (!cols || !cols.has(col)) return col;
    return null;
  };

  const side = sideHint === 0 ? 1 : sideHint;
  const orderedOffsets: number[] = [0];
  for (let radius = 1; radius <= 40; radius++) {
    if (sideHint === 0) {
      orderedOffsets.push(radius, -radius);
    } else {
      orderedOffsets.push(radius * side, -radius * side);
    }
  }

  for (const offset of orderedOffsets) {
    const found = tryColumn(normalizedPreferred + offset);
    if (found != null) return found;
  }

  return normalizedPreferred;
}

export function autoLayoutFlowchart(
  nodes: Node<FlowchartNodeData>[],
  edges: Edge[],
): FlowchartLayoutResult {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const edgeLabelLookup = new Map<string, string>();

  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }

  for (const edge of edges) {
    const src = edge.source;
    const tgt = edge.target;
    if (!outgoing.has(src) || !incoming.has(tgt)) continue;
    outgoing.get(src)!.push(tgt);
    incoming.get(tgt)!.push(src);
    edgeLabelLookup.set(`${src}->${tgt}`, edge.label ? String(edge.label) : '');
  }

  const roots = nodes
    .filter(n => incoming.get(n.id)?.length === 0 && isStartLike(n))
    .map(n => n.id);

  if (roots.length === 0) {
    const unlabeledRoots = nodes.filter(n => incoming.get(n.id)?.length === 0).map(n => n.id);
    if (unlabeledRoots.length > 0) roots.push(...unlabeledRoots);
  }
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0].id);

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const backEdges = new Set<string>();

  function markCycles(id: string) {
    visited.add(id);
    inStack.add(id);
    for (const next of outgoing.get(id) || []) {
      if (inStack.has(next)) {
        backEdges.add(`${id}->${next}`);
      } else if (!visited.has(next)) {
        markCycles(next);
      }
    }
    inStack.delete(id);
  }

  for (const root of roots) {
    if (!visited.has(root)) markCycles(root);
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) markCycles(node.id);
  }

  const layerMemo = new Map<string, number>();
  function getLayer(id: string): number {
    if (layerMemo.has(id)) return layerMemo.get(id)!;
    const parents = (incoming.get(id) || []).filter(src => !backEdges.has(`${src}->${id}`));
    if (parents.length === 0) {
      layerMemo.set(id, 0);
      return 0;
    }
    const layer = Math.max(...parents.map(getLayer)) + 1;
    layerMemo.set(id, layer);
    return layer;
  }

  const layers = new Map<number, string[]>();
  for (const node of nodes) {
    const layer = getLayer(node.id);
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(node.id);
  }

  const layerHeights = new Map<number, number>();
  let maxColumnFootprint = 0;
  for (const node of nodes) {
    const footprint = shapeFootprint(node);
    maxColumnFootprint = Math.max(maxColumnFootprint, footprint.width);
    const layer = getLayer(node.id);
    const current = layerHeights.get(layer) || 0;
    layerHeights.set(layer, Math.max(current, footprint.height));
  }

  const columnSpacing = Math.max(maxColumnFootprint + COLUMN_PADDING, MIN_COLUMN_SPACING);
  const rowSpacingByLayer = new Map<number, number>();
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  for (const layer of sortedLayers) {
    const layerHeight = layerHeights.get(layer) || 0;
    rowSpacingByLayer.set(layer, Math.max(layerHeight + ROW_PADDING, MIN_ROW_SPACING));
  }

  const assignedCol = new Map<string, number>();
  const occupied = new Map<number, Set<number>>();
  const assignedSide = new Map<string, Side>();

  function occupy(layer: number, col: number) {
    if (!occupied.has(layer)) occupied.set(layer, new Set());
    occupied.get(layer)!.add(col);
  }

  function placeNode(id: string, preferred: number, sideHint: Side = 0): number {
    const layer = getLayer(id);
    const col = searchFreeColumn(occupied, layer, preferred, sideHint);
    assignedCol.set(id, col);
    occupy(layer, col);
    return col;
  }

  function assignSubtree(id: string, preferred: number, sideHint: Side = 0) {
    if (assignedCol.has(id)) return;

    const parentSide = assignedSide.get(id) ?? sideHint;
    const col = placeNode(id, preferred, parentSide);

    const node = nodeMap.get(id);
    if (!node) return;

    const children = (outgoing.get(id) || []).filter(next => !backEdges.has(`${id}->${next}`));
    if (children.length === 0) return;

    const orderedChildren = sortChildren(node, children, edgeLabelLookup, nodeMap);

    if (isDecision(node)) {
      const primaryChild = orderedChildren.find(child => normalizeLabel(edgeLabelLookup.get(`${id}->${child}`)) === 'yes')
        ?? orderedChildren.find(child => !isErrorLike(nodeMap.get(child)!))
        ?? orderedChildren[0];

      assignedSide.set(primaryChild, 0);
      assignSubtree(primaryChild, col, 0);

      let leftOffset = 1;
      let rightOffset = 1;
      for (const childId of orderedChildren) {
        if (childId === primaryChild) continue;
        const edgeLabel = normalizeLabel(edgeLabelLookup.get(`${id}->${childId}`));
        const childNode = nodeMap.get(childId)!;
        const childSide: Side = edgeLabel === 'no' || isErrorLike(childNode) ? -1 : 1;
        const offset = childSide === -1 ? -leftOffset++ : rightOffset++;
        assignedSide.set(childId, childSide);
        assignSubtree(childId, col + offset, childSide);
      }
      return;
    }

    if (orderedChildren.length === 1) {
      const childId = orderedChildren[0];
      if (!assignedSide.has(childId)) assignedSide.set(childId, 0);
      assignSubtree(childId, col, assignedSide.get(childId) ?? 0);
      return;
    }

    const [primaryChild, ...sideChildren] = orderedChildren;
    assignedSide.set(primaryChild, 0);
    assignSubtree(primaryChild, col, 0);

    sideChildren.forEach((childId, index) => {
      const childSide: Side = index % 2 === 0 ? 1 : -1;
      const offset = childSide * (Math.floor(index / 2) + 1);
      assignedSide.set(childId, childSide);
      assignSubtree(childId, col + offset, childSide);
    });
  }

  const sortedRoots = [...roots].sort((a, b) => {
    const na = nodeMap.get(a)?.data.label || '';
    const nb = nodeMap.get(b)?.data.label || '';
    const aStart = isStartLike(nodeMap.get(a)!) ? -1 : 0;
    const bStart = isStartLike(nodeMap.get(b)!) ? -1 : 0;
    if (aStart !== bStart) return aStart - bStart;
    return na.localeCompare(nb);
  });

  const rootOffsets = sortedRoots.length === 1
    ? [0]
    : [0, 1, -1, 2, -2, 3, -3];
  sortedRoots.forEach((rootId, index) => {
    const offset = rootOffsets[index] ?? 0;
    if (!assignedSide.has(rootId)) assignedSide.set(rootId, 0);
    assignSubtree(rootId, offset * 2, 0);
  });

  for (const node of nodes) {
    if (!assignedCol.has(node.id)) {
      const parents = (incoming.get(node.id) || []).filter(src => assignedCol.has(src));
      const preferred = parents.length > 0
        ? parents.reduce((sum, parentId) => sum + (assignedCol.get(parentId) || 0), 0) / parents.length
        : 0;
      const dominantSide = parents.length > 0
        ? Math.sign(parents.reduce((sum, parentId) => sum + (assignedSide.get(parentId) || 0), 0)) as Side
        : 0;
      assignSubtree(node.id, preferred, dominantSide);
    }
  }

  for (const node of nodes) {
    const parents = (incoming.get(node.id) || []).filter(src => assignedCol.has(src) && !backEdges.has(`${src}->${node.id}`));
    if (parents.length >= 2) {
      const parentCols = parents.map(id => assignedCol.get(id) || 0);
      const average = parentCols.reduce((sum, value) => sum + value, 0) / parentCols.length;
      const target = Math.round(average);
      const layer = getLayer(node.id);
      const current = assignedCol.get(node.id);
      if (current != null && current !== target && !(occupied.get(layer)?.has(target))) {
        occupied.get(layer)?.delete(current);
        occupy(layer, target);
        assignedCol.set(node.id, target);
      }
    }
  }

  const minCol = Math.min(...assignedCol.values(), 0);
  const normalizedCols = new Map<string, number>();
  for (const [id, col] of assignedCol) {
    normalizedCols.set(id, col - minCol);
  }

  let currentY = START_Y;
  const layerY = new Map<number, number>();
  for (const layer of sortedLayers) {
    layerY.set(layer, currentY);
    currentY += (rowSpacingByLayer.get(layer) || MIN_ROW_SPACING) + 18;
  }

  const positionedNodes = nodes.map(node => {
    const layer = getLayer(node.id);
    const footprint = shapeFootprint(node);
    const col = normalizedCols.get(node.id) ?? 0;
    return {
      ...node,
      position: {
        x: START_X + maxColumnFootprint / 2 + col * columnSpacing - footprint.width / 2,
        y: layerY.get(layer) ?? START_Y,
      },
      style: {
        ...node.style,
        width: footprint.width,
        height: footprint.height,
      },
    };
  });

  const positionedNodeMap = new Map(positionedNodes.map(node => [node.id, node]));
  const rightBoundary = Math.max(...positionedNodes.map(node => node.position.x + Number(node.style.width)));

  let returnLane = 0;
  const newEdges = edges.filter(edge => positionedNodeMap.has(edge.source) && positionedNodeMap.has(edge.target)).map((edge, index) => {
    const source = positionedNodeMap.get(edge.source);
    const target = positionedNodeMap.get(edge.target);
    if (!source || !target) return edge;

    const isReturn = backEdges.has(`${edge.source}->${edge.target}`);
    const handles = isReturn
      ? { sourceHandle: 'right', targetHandle: 'right' }
      : { sourceHandle: isDecision(source) && Math.abs(getNodeCenter(source).x - getNodeCenter(target).x) > 40
          ? (getNodeCenter(target).x < getNodeCenter(source).x ? 'left' : 'right') : 'bottom', targetHandle: 'top' };
    return {
      ...edge,
      id: edge.id || `flowchart_edge_${index}`,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: 'smoothstep',
      pathOptions: { offset: isReturn ? rightBoundary - Math.max(source.position.x + Number(source.style.width), target.position.x + Number(target.style.width)) + 64 + returnLane++ * 24 : 20 },
      markerEnd: edge.markerEnd || { type: MarkerType.ArrowClosed, color: '#b1b1b7' },
    };
  });

  return { nodes: positionedNodes, edges: newEdges };
}
