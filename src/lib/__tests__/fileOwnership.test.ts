import { describe, expect, it } from 'vitest';
import { isFileCreator, isFileViewer } from '../fileOwnership';

describe('file ownership UI guard', () => {
  it('allows only the creator and keeps legacy records fail-closed', () => {
    expect(isFileCreator({ user_id: 'user-1' }, 'user-1')).toBe(true);
    expect(isFileCreator({ userId: 'user-2' }, 'user-1')).toBe(false);
    expect(isFileCreator({ user_id: null }, 'user-1')).toBe(false);
    expect(isFileCreator({ user_id: null }, 'guest', true)).toBe(true);
  });
});

describe('file viewer guard', () => {
  it('opens read-only only when another owner is known', () => {
    expect(isFileViewer({ user_id: 'user-2' }, 'user-1')).toBe(true);
    expect(isFileViewer({ userId: 'user-1' }, 'user-1')).toBe(false);
    expect(isFileViewer({}, 'user-1')).toBe(false);
    expect(isFileViewer({ user_id: 'user-2' }, 'guest', true)).toBe(false);
  });
});
