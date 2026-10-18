import { createContext, useContext, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { Entity } from '@/types';

/**
 * Live ERD nodes and edges. They change on every drag frame, so they live outside WorkspaceContext:
 * only the canvas and the panels that read them re-render while dragging.
 */
export interface ERDCanvasContextValue {
  nodes: Node<Entity>[];
  edges: Edge[];
}

const ERDCanvasContext = createContext<ERDCanvasContextValue>({ nodes: [], edges: [] });

export const ERDCanvasProvider = ERDCanvasContext.Provider;

export function useERDCanvas(): ERDCanvasContextValue {
  return useContext(ERDCanvasContext);
}

/**
 * The canvas as of the last settled state: it holds the previous value while a table is dragged and
 * catches up on drop. For layout-level consumers that must not re-render on every drag frame.
 */
const SettledERDCanvasContext = createContext<ERDCanvasContextValue>({ nodes: [], edges: [] });

export const SettledERDCanvasProvider = SettledERDCanvasContext.Provider;

export function useSettledERDCanvas(): ERDCanvasContextValue {
  return useContext(SettledERDCanvasContext);
}

export function useSettledERDCanvasSnapshot(canvas: ERDCanvasContextValue): ERDCanvasContextValue {
  const settled = useRef(canvas);
  if (!canvas.nodes.some(node => node.dragging)) settled.current = canvas;
  return settled.current;
}
