import type { Node, Edge } from '@xyflow/react';
import type { Entity } from '@/types';
import { tableSize } from './erd-geometry';

export function autoLayoutERD(nodes: Node<Entity>[], edges: Edge[]): Node<Entity>[] {
  if (!nodes.length) return nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const compare = (a: string, b: string) => byId.get(a)!.data.name.localeCompare(byId.get(b)!.data.name) || a.localeCompare(b);
  const ids = [...byId.keys()].sort(compare);
  const parents = new Map(ids.map(id => [id, new Set<string>()]));
  const neighbors = new Map(ids.map(id => [id, new Set<string>()]));
  for (const edge of edges) if (byId.has(edge.source) && byId.has(edge.target) && edge.source !== edge.target) {
    parents.get(edge.source)!.add(edge.target);
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }

  // Collapse cycles so they cannot swallow their descendants' layers.
  let index = 0;
  const indices = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), components: string[][] = [];
  const visit = (id: string) => {
    indices.set(id, index); low.set(id, index++); stack.push(id); active.add(id);
    for (const parent of [...parents.get(id)!].sort(compare)) {
      if (!indices.has(parent)) { visit(parent); low.set(id, Math.min(low.get(id)!, low.get(parent)!)); }
      else if (active.has(parent)) low.set(id, Math.min(low.get(id)!, indices.get(parent)!));
    }
    if (low.get(id) === indices.get(id)) {
      const group: string[] = [];
      let member: string;
      do { member = stack.pop()!; active.delete(member); group.push(member); } while (member !== id);
      components.push(group.sort(compare));
    }
  };
  ids.forEach(id => { if (!indices.has(id)) visit(id); });
  const componentOf = new Map(components.flatMap((group, i) => group.map(id => [id, i] as const)));
  const ranks = new Map<number, number>();
  const rank = (i: number): number => {
    if (ranks.has(i)) return ranks.get(i)!;
    let value = 0;
    for (const id of components[i]) for (const parent of parents.get(id)!) {
      const p = componentOf.get(parent)!;
      if (p !== i) value = Math.max(value, rank(p) + 1);
    }
    ranks.set(i, value); return value;
  };
  components.forEach((_, i) => rank(i));

  const positions = new Map<string, { x: number; y: number }>();
  const seen = new Set<string>();
  let groupY = 50;
  for (const root of ids) {
    if (seen.has(root)) continue;
    const group = [root]; seen.add(root);
    for (let i = 0; i < group.length; i++) for (const neighbor of [...neighbors.get(group[i])!].sort(compare)) {
      if (!seen.has(neighbor)) { seen.add(neighbor); group.push(neighbor); }
    }
    const layers = new Map<number, string[]>();
    for (const id of group) {
      const r = ranks.get(componentOf.get(id)!)!;
      layers.set(r, [...layers.get(r) || [], id]);
    }
    let x = 50, bottom = groupY;
    for (const [, layer] of [...layers].sort(([a], [b]) => a - b)) {
      const parentCenter = (id: string) => {
        const points = [...parents.get(id)!].map(p => positions.get(p)).filter(p => p !== undefined);
        return points.length ? points.reduce((s, p) => s + p.y, 0) / points.length : groupY;
      };
      layer.sort((a, b) => parentCenter(a) - parentCenter(b) || compare(a, b));
      let y = groupY;
      for (const id of layer) {
        y = Math.max(y, parentCenter(id));
        positions.set(id, { x, y });
        y += tableSize(byId.get(id)!).height + 48;
      }
      bottom = Math.max(bottom, y);
      x += Math.max(...layer.map(id => tableSize(byId.get(id)!).width)) + 120;
    }
    groupY = bottom + 72;
  }
  return nodes.map(node => ({ ...node, position: positions.get(node.id)!, data: { ...node.data } }));
}
