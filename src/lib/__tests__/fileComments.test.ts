import { describe, expect, it } from 'vitest';
import { COMMENT_STEP, hiddenCount, storedHasAnchor, visibleMessages } from '../fileComments';

describe('comment paging window', () => {
  const messages = Array.from({ length: 25 }, (_, index) => index + 1);

  it('shows the newest ten first', () => {
    expect(visibleMessages(messages, COMMENT_STEP)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(hiddenCount(messages.length, COMMENT_STEP)).toBe(15);
  });

  it('reveals older messages ten at a time and never past what is loaded', () => {
    expect(visibleMessages(messages, COMMENT_STEP * 2)).toHaveLength(20);
    expect(visibleMessages(messages, COMMENT_STEP * 3)).toHaveLength(25);
    expect(hiddenCount(messages.length, COMMENT_STEP * 3)).toBe(0);
  });

  it('shows a short thread whole', () => {
    expect(visibleMessages([1, 2], COMMENT_STEP)).toEqual([1, 2]);
  });
});

describe('storedHasAnchor', () => {
  const saved = JSON.stringify({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e1' }] });

  it('finds a saved node or edge by its anchor type', () => {
    expect(storedHasAnchor(saved, { type: 'shape', id: 'b' })).toBe(true);
    expect(storedHasAnchor(saved, { type: 'table', id: 'a' })).toBe(true);
    expect(storedHasAnchor(saved, { type: 'relationship', id: 'e1' })).toBe(true);
  });

  it('misses what only exists in the browser, even if another list has that id', () => {
    expect(storedHasAnchor(saved, { type: 'shape', id: 'new' })).toBe(false);
    expect(storedHasAnchor(saved, { type: 'relationship', id: 'a' })).toBe(false);
    expect(storedHasAnchor(JSON.stringify({ nodes: [], edges: [] }), { type: 'shape', id: 'a' })).toBe(false);
  });

  it('takes parsed data and treats unreadable or position-only data as not saved', () => {
    expect(storedHasAnchor({ nodes: [{ id: 'a' }] }, { type: 'shape', id: 'a' })).toBe(true);
    expect(storedHasAnchor('not json', { type: 'shape', id: 'a' })).toBe(false);
    expect(storedHasAnchor(undefined, { type: 'shape', id: 'a' })).toBe(false);
    expect(storedHasAnchor({ nodes: { a: { x: 1 } } }, { type: 'table', id: 'a' })).toBe(false);
  });
});
