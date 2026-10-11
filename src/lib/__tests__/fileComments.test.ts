import { describe, expect, it } from 'vitest';
import { COMMENT_STEP, hiddenCount, visibleMessages } from '../fileComments';

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
