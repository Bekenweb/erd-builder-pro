import { expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const slots = hooks.slots, index = hooks.cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));
import { AIActionProvider, type AIActionContextValue, type RightPanelMode } from './AIActionContext';

function render(slots: any[], mode: RightPanelMode, onMode: (mode: RightPanelMode) => void) {
  hooks.slots = slots; hooks.cursor = 0;
  const tree = AIActionProvider({ children: null, panelMode: mode, onPanelModeChange: onMode }) as unknown as { props: { children: { props: { value: AIActionContextValue } } } };
  return tree.props.children.props.value;
}

it('shares one panel mode while keeping prompts and content handlers bound to each file', () => {
  const first: any[] = [], second: any[] = [];
  const onMode = vi.fn(), applyFirst = vi.fn(), applySecond = vi.fn();
  render(first, 'closed', onMode).registerContentHandler(applyFirst, ['append']);
  render(second, 'closed', onMode).registerContentHandler(applySecond);
  render(first, 'closed', onMode).sendAction('For the first file');
  expect(onMode).toHaveBeenCalledWith('chat');
  const active = render(first, 'chat', onMode), other = render(second, 'chat', onMode);
  expect(active.pendingPrompt).toBe('For the first file');
  expect(other.pendingPrompt).toBeNull();
  expect(other.rightPanelMode).toBe('chat');
  expect(active.applyContent('schema', 'append')).toBe(true);
  expect(applyFirst).toHaveBeenCalledWith('schema', 'append', undefined);
  expect(applySecond).not.toHaveBeenCalled();
  expect(other.applyContent('note', 'replace')).toBe(true);
  expect(applySecond).toHaveBeenCalledWith('note', 'replace', undefined);
});
