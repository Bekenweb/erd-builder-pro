export type RoutePoint = { x: number; y: number };
export type RouteObstacle = RoutePoint & { id?: string; width: number; height: number };

export function edgeRoutingObstacles(tables: RouteObstacle[], endpoints: RouteObstacle[]): RouteObstacle[] {
  const live = new Map(endpoints.filter(table => table.id !== undefined).map(table => [table.id, table]));
  return tables.map(table => live.get(table.id) ?? table);
}

export function segmentBlocked(a: RoutePoint, b: RoutePoint, obstacles: RouteObstacle[]) {
  return obstacles.some(r => a.x === b.x
    ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height
    : a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width);
}

/** Orthogonal visibility grid around table boundaries, searched by Manhattan distance. */
export function routeErdEdge(source: RoutePoint, target: RoutePoint, sourceRight: boolean, targetRight: boolean, tables: RouteObstacle[]): RoutePoint[] {
  const start = { x: source.x + (sourceRight ? 16 : -16), y: source.y };
  const end = { x: target.x + (targetRight ? 16 : -16), y: target.y };
  const obstacles = tables.map(r => ({ x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }));
  if (source.x === target.x && source.y === target.y) {
    const outside = start.x + (sourceRight ? 16 : -16);
    return [source, start, { x: start.x, y: start.y - 24 }, { x: outside, y: start.y - 24 }, { x: outside, y: target.y }, target];
  }
  const simple = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ].find(points => points.slice(1).every((p, i) => !segmentBlocked(points[i], p, obstacles)));
  if (simple) return [source, ...simple, target];
  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap(r => [r.x, r.x + r.width])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap(r => [r.y, r.y + r.height])])].sort((a, b) => a - b);
  const key = (x: number, y: number) => y * xs.length + x;
  const point = (id: number) => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
  const first = key(xs.indexOf(start.x), ys.indexOf(start.y)), last = key(xs.indexOf(end.x), ys.indexOf(end.y));
  const distance = (p: RoutePoint) => Math.abs(p.x - end.x) + Math.abs(p.y - end.y);
  const costs = new Map([[first, 0]]), previous = new Map<number, number>();
  const open = [{ id: first, cost: distance(start) }];
  const visited = new Set<number>();
  while (open.length) {
    open.sort((a, b) => b.cost - a.cost || b.id - a.id);
    const id = open.pop()!.id;
    if (visited.has(id)) continue;
    if (id === last) {
      const route = [end];
      let cursor = id;
      while (previous.has(cursor)) { cursor = previous.get(cursor)!; route.push(point(cursor)); }
      const points = [source, ...route.reverse(), target];
      return points.filter((p, i) => !i || i === points.length - 1
        || !((points[i - 1].x === p.x && p.x === points[i + 1].x) || (points[i - 1].y === p.y && p.y === points[i + 1].y)));
    }
    visited.add(id);
    const x = id % xs.length, y = Math.floor(id / xs.length), a = point(id);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
      const next = key(nx, ny), b = point(next);
      if (visited.has(next) || segmentBlocked(a, b, obstacles)) continue;
      const cost = costs.get(id)! + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); previous.set(next, id);
      open.push({ id: next, cost: cost + distance(b) });
    }
  }
  // Overlapping legacy tables can enclose a port; retain a readable outside lane until moved apart.
  const y = Math.min(source.y, target.y, ...obstacles.map(r => r.y)) - 24;
  return [source, start, { x: start.x, y }, { x: end.x, y }, end, target];
}
