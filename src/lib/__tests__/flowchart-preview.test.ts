import { expect, it } from 'vitest';
import { MarkerType } from '@xyflow/react';
import { appendFlowchart, compareFlowcharts, replaceFlowchartGroup, type FlowchartCanvas } from '../flowchart-preview';
import { previewFlowchartContent, applyInsertBetween } from '@/components/ai/actions/flowchartActions';

const node = (id: string, label: string, shape = 'rectangle') => ({ id, type: 'custom', data: { label, shape, color: '#6b7280' }, position: { x: 0, y: 0 } }) as FlowchartCanvas['nodes'][number];

it('defaults to monochrome while retaining colors supplied by AI for generation and insertion', () => {
  const preview = previewFlowchartContent(JSON.stringify({ nodes: [{ label: 'A', color: '#ff0000' }, { label: 'B' }, { label: 'Empty', color: ' ' }], edges: [{ sourceLabel: 'A', targetLabel: 'B' }] }))!;
  expect(preview.nodes.map(n => n.data.color)).toEqual(['#ff0000', '#6b7280', '#6b7280']);
  const inserted = applyInsertBetween(preview.nodes, preview.edges, '```json\n' + JSON.stringify({ sourceLabel: 'A', targetLabel: 'B', newNode: { label: 'C', color: '#abcdef' } }) + '\n```')!;
  expect(inserted.nodes.find(n => n.data.label === 'C')!.data.color).toBe('#abcdef');
  expect(inserted.nodes.find(n => n.data.label === 'A')!.data.color).toBe('#ff0000');
});

it('compares node properties and connector labels, line styles and arrow direction across regenerated IDs', () => {
  const before: FlowchartCanvas = { nodes: [node('a', 'A'), node('b', 'B')], edges: [{ id: 'old', source: 'a', target: 'b', label: 'Yes', markerEnd: { type: MarkerType.ArrowClosed } }] };
  const after: FlowchartCanvas = { nodes: [node('new-a', 'A', 'diamond'), node('new-b', 'B')], edges: [{ id: 'new', source: 'new-a', target: 'new-b', label: 'No', style: { strokeDasharray: '5,5' }, markerStart: { type: MarkerType.ArrowClosed } }] };
  const changes = compareFlowcharts(before, after);
  expect(changes).toHaveLength(2);
  expect(changes[0]).toMatchObject({ kind: 'Shape', status: 'Changed', label: 'A' });
  expect(changes[1]).toMatchObject({ kind: 'Connector', status: 'Changed' });
  expect(changes[1].detail).toContain('label: Yes → No');
  expect(changes[1].detail).toContain('dashed:');
  expect(changes[1].detail).toContain('start:');
});

it('reports additions, removals and parallel connectors without collapsing duplicate labels', () => {
  const before: FlowchartCanvas = { nodes: [node('a', 'A'), node('b', 'B'), node('c', 'Removed')], edges: [{ id: 'one', source: 'a', target: 'b', label: 'Yes' }, { id: 'two', source: 'a', target: 'b', label: 'No' }] };
  const after = { nodes: [node('a', 'A'), node('b', 'B'), node('d', 'Added')], edges: [before.edges[0]] };
  expect(compareFlowcharts(before, after).map(c => `${c.status} ${c.kind}`)).toEqual(['Added Shape', 'Removed Shape', 'Removed Connector']);
  expect(compareFlowcharts(before, before)).toEqual([]);
});

it('appends repeated AI results with unique IDs and preserves unrelated groups on replacement', () => {
  const addition = { nodes: [node('a', 'A'), node('b', 'B')], edges: [{ id: 'ab', source: 'a', target: 'b' }] };
  const appended = appendFlowchart(addition, addition);
  expect(new Set(appended.nodes.map(n => n.id)).size).toBe(4);
  expect(new Set(appended.edges.map(e => e.id)).size).toBe(2);
  const before = { nodes: [{ ...node('root', 'Root'), data: { ...node('root', 'Root').data, section: 'Group' } }, node('child', 'Child'), node('kept', 'Keep me')], edges: [{ id: 'rc', source: 'root', target: 'child' }] };
  const replaced = replaceFlowchartGroup(before, addition, 'Group');
  expect(replaced.nodes.map(n => n.data.label).sort()).toEqual(['A', 'B', 'Keep me']);
});
