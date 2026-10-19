import { segmentBlocked, type RouteObstacle, type RoutePoint } from './erd-routing';

export type LabelRoute = { id: string; points: RoutePoint[]; label: string };
export type LabelAnchor = { segment: number; ratio: number; width: number; height: number; shared: boolean };

export function straightRoute(points: RoutePoint[]) {
  const result: RoutePoint[] = [];
  for (const point of points) {
    const last = result.at(-1), before = result.at(-2);
    if (last?.x === point.x && last.y === point.y) continue;
    if (before && last && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}

function overlaps(a: RouteObstacle, b: RouteObstacle) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function labelPoint(points: RoutePoint[], anchor: LabelAnchor, tables: RouteObstacle[] = []): RoutePoint | null {
  const route = straightRoute(points), a = route[anchor.segment], b = route[anchor.segment + 1];
  if (!a || !b) return null;
  const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  const margin = (a.y === b.y ? anchor.width : anchor.height) / 2 + 12;
  if (length < margin * 2) return null;
  const ratio = Math.min(1 - margin / length, Math.max(margin / length, anchor.ratio));
  const point = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
  return tables.some(table => overlaps(labelBox(point, anchor), table)) ? null : point;
}

function labelBox(point: RoutePoint, anchor: LabelAnchor): RouteObstacle {
  return { x: point.x - anchor.width / 2 - 4, y: point.y - anchor.height / 2 - 4, width: anchor.width + 8, height: anchor.height + 8 };
}

function candidates(route: LabelRoute): LabelAnchor[] {
  const points = straightRoute(route.points);
  const width = Math.max(32, route.label.length * 7 + 8), height = 22;
  return points.slice(1).flatMap((b, segment) => {
    const a = points[segment], length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const along = a.y === b.y ? width : height;
    const margin = along / 2 + 12;
    if (length < margin * 2) return [];
    const offsets = new Set([length / 2, margin, length - margin]);
    for (let offset = margin; offset <= length - margin; offset += along + 12) offsets.add(offset);
    return [...offsets].sort((a, b) => Math.abs(a - length / 2) - Math.abs(b - length / 2))
      .map(offset => ({ segment, ratio: offset / length, width, height, shared: false }));
  }).sort((a, b) => Number(points[a.segment].x === points[a.segment + 1].x) - Number(points[b.segment].x === points[b.segment + 1].x));
}

export function placeErdLabels(routes: LabelRoute[], tables: RouteObstacle[]): Map<string, LabelAnchor> {
  const result = new Map<string, LabelAnchor>();
  const occupied: RouteObstacle[] = [];
  const shared: LabelRoute[] = [];
  for (const route of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const safe = candidates(route).filter(anchor => {
      const box = labelBox(labelPoint(route.points, anchor)!, anchor);
      return ![...tables, ...occupied].some(other => overlaps(box, other));
    });
    const chosen = safe.find(anchor => {
      const box = labelBox(labelPoint(route.points, anchor)!, anchor);
      return !routes.some(other => other.id !== route.id && other.points.slice(1).some((b, i) => segmentBlocked(other.points[i], b, [box])));
    });
    if (chosen) {
      result.set(route.id, chosen);
      occupied.push(labelBox(labelPoint(route.points, chosen)!, chosen));
    } else if (safe[0]) {
      shared.push(route);
    }
  }
  // Shared labels appear individually, but must still avoid every permanently visible label.
  for (const route of shared) {
    const anchor = candidates(route).find(anchor => {
      const box = labelBox(labelPoint(route.points, anchor)!, anchor);
      return ![...tables, ...occupied].some(other => overlaps(box, other));
    });
    if (anchor) result.set(route.id, { ...anchor, shared: true });
  }
  return result;
}

export function showErdLabel(id: string, anchors: Map<string, LabelAnchor>, activeId: string | null) {
  const anchor = anchors.get(id);
  if (!anchor) return false;
  return !anchor.shared || id === activeId;
}
