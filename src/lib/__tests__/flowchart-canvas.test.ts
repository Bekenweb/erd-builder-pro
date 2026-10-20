import { expect, it } from 'vitest';
import { normalizeFlowchartCanvas } from '../flowchart-canvas';

it('retains an intentionally empty canvas and a deleted last connector', () => {
  expect(normalizeFlowchartCanvas([], [])).toEqual({ nodes: [], edges: [] });
  expect(normalizeFlowchartCanvas([{ id: 'a', data: {}, position: { x: 0, y: 0 } }] as any, []).edges).toEqual([]);
});

it('makes imported connectors addressable and removes orphan edges', () => {
  const nodes = [1, 2].map(id => ({ id, data: {}, position: { x: 0, y: 0 } }));
  const canvas = normalizeFlowchartCanvas(nodes as any, [
    { source: 1, target: 2 }, { id: 5, source: 2, target: 1 },
    { id: 5, source: 1, target: 2 }, { source: 1, target: 99 },
  ] as any);
  expect(canvas.nodes.map(node => node.id)).toEqual(['1', '2']);
  expect(canvas.edges).toHaveLength(3);
  expect(new Set(canvas.edges.map(edge => edge.id)).size).toBe(3);
  expect(canvas.edges.every(edge => typeof edge.id === 'string' && typeof edge.source === 'string')).toBe(true);
});
