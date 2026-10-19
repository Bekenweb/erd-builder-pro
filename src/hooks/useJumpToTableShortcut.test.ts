import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, active: true }));
vi.mock('react', () => ({ useEffect: (effect: () => void) => mocks.effects.push(effect) }));
vi.mock('@/contexts/FileSessionContext', () => ({ useEditorActive: () => () => mocks.active }));
import { useJumpToTableShortcut } from './useJumpToTableShortcut';

const add = vi.fn(), remove = vi.fn(), open = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); mocks.effects = []; mocks.active = true;
  vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
});
afterEach(() => vi.unstubAllGlobals());

function setup(platform: string, enabled = true) {
  vi.stubGlobal('navigator', { platform });
  const shortcut = useJumpToTableShortcut(enabled, open);
  const cleanup = mocks.effects[0]();
  const handle = add.mock.calls[0]?.[1] as (event: KeyboardEvent) => void;
  return { shortcut, cleanup, handle };
}
function key(overrides: Record<string, unknown> = {}) {
  return { key: 'F', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, isComposing: false,
    defaultPrevented: false, target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides } as unknown as KeyboardEvent;
}

describe('SH-004 Jump to Table Find shortcut', () => {
  it('opens search only for the focused editor in a two-file workspace', () => {
    const { handle } = setup('Win32');
    mocks.active = false;
    handle(key());
    expect(open).not.toHaveBeenCalled();
    mocks.active = true;
    handle(key());
    expect(open).toHaveBeenCalledOnce();
  });
  it.each([['MacIntel', '⇧⌘F', true, false], ['Win32', 'Ctrl+Shift+F', false, true], ['Linux x86_64', 'Ctrl+Shift+F', false, true]])(
    'opens table search and prevents browser Find on %s', (platform, label, metaKey, ctrlKey) => {
      const { shortcut, handle, cleanup } = setup(platform);
      const event = key({ metaKey, ctrlKey });
      handle(event);
      expect(shortcut.label).toBe(label);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledOnce();
      if (cleanup) cleanup();
      expect(remove).toHaveBeenCalledWith('keydown', handle, true);
    });

  it('does not install a handler for Flowchart or DB Client', () => {
    setup('Win32', false);
    expect(add).not.toHaveBeenCalled();
  });

  it.each([['MacIntel', true, false], ['Win32', false, true]])(
    'does not intercept the original editor/browser Find shortcut on %s', (platform, metaKey, ctrlKey) => {
      const { handle } = setup(platform);
      const event = key({ metaKey, ctrlKey, shiftKey: false });
      handle(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });

  it.each([{ ctrlKey: false }, { shiftKey: false }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'g' }])(
    'leaves unrelated shortcuts and composition alone: %j', overrides => {
      const { handle } = setup('Win32');
      const event = key(overrides);
      handle(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });

  it('keeps local editor search and modal keyboard scopes intact', () => {
    const { handle } = setup('Win32');
    const event = key({ target: { closest: () => ({}) } });
    handle(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
