import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => {
    const index = hooks.cursor++;
    return hooks.slots[index] ??= { current };
  },
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], vi.fn()];
  },
}));

import { useStableHandlers } from './useStableHandlers';
import { useUndoRedo } from './useUndoRedo';
import { useSettledERDCanvasSnapshot, type ERDCanvasContextValue } from '@/contexts/ERDCanvasContext';

// Preserve hook slots across simulated renders, without installing a DOM test runtime.
function render<T>(hook: () => T): T {
  hooks.cursor = 0;
  return hook();
}

beforeEach(() => { hooks.slots = []; });

describe('SH-004 stable canvas handlers', () => {
  it('keeps identities while forwarding arguments to the latest implementation', () => {
    const first = vi.fn((id: string) => `old:${id}`);
    const latest = vi.fn((id: string) => `new:${id}`);
    const stable = render(() => useStableHandlers({ duplicate: first }));
    expect(stable.duplicate('users')).toBe('old:users');
    const updated = render(() => useStableHandlers({ duplicate: latest }));
    expect(updated).toBe(stable);
    expect(updated.duplicate).toBe(stable.duplicate);
    expect(stable.duplicate('posts')).toBe('new:posts');
    expect(first).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledWith('posts');
  });

  it('preserves promises and thrown errors', async () => {
    const promise = Promise.resolve('saved');
    const stable = render(() => useStableHandlers({ save: () => promise }));
    expect(stable.save()).toBe(promise);
    const error = new Error('save rejected');
    render(() => useStableHandlers({ save: () => { throw error; } }));
    expect(() => stable.save()).toThrow(error);
    const rejected = Promise.reject(error);
    render(() => useStableHandlers({ save: () => rejected }));
    await expect(stable.save()).rejects.toBe(error);
  });
});

describe('SH-004 settled canvas snapshot', () => {
  const canvas = (dragging: boolean[], x = 0): ERDCanvasContextValue => ({
    nodes: dragging.map((value, index) => ({ id: String(index), position: { x, y: 0 }, dragging: value, data: {} })) as ERDCanvasContextValue['nodes'],
    edges: [{ id: 'relation', source: '0', target: '1' }],
  });

  it('holds nodes and edges until every dragged table has settled', () => {
    const initial = canvas([false, false]);
    expect(render(() => useSettledERDCanvasSnapshot(initial))).toBe(initial);
    expect(render(() => useSettledERDCanvasSnapshot(canvas([true, true], 10)))).toBe(initial);
    expect(render(() => useSettledERDCanvasSnapshot(canvas([false, true], 20)))).toBe(initial);
    const dropped = canvas([false, false], 30);
    const settled = render(() => useSettledERDCanvasSnapshot(dropped));
    expect(settled).toBe(dropped);
    expect(settled.nodes[0].position.x).toBe(30);
    expect(settled.edges).toBe(dropped.edges);
  });

  it('immediately publishes non-drag updates and an empty canvas', () => {
    render(() => useSettledERDCanvasSnapshot(canvas([false])));
    const changed = canvas([false], 50);
    expect(render(() => useSettledERDCanvasSnapshot(changed))).toBe(changed);
    const empty = { nodes: [], edges: [] };
    expect(render(() => useSettledERDCanvasSnapshot(empty))).toBe(empty);
  });
});

it('SH-004 restores the pre-drag position on the first Undo and the final position on Redo', () => {
  const history = render(() => useUndoRedo());
  const before = [{ id: 'table', position: { x: 20, y: 30 }, dragging: true, data: {} }];
  const after = [{ ...before[0], position: { x: 200, y: 300 }, dragging: false }];
  history.takeSnapshot(before, []);
  const restored = history.undo(after, [])!;
  expect(restored.nodes[0]).toMatchObject({ position: { x: 20, y: 30 }, dragging: false });
  expect(history.redo(restored.nodes, [])!.nodes[0].position).toEqual({ x: 200, y: 300 });
});
