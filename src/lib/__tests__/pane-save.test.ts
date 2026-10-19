import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceContextValue } from '@/providers/WorkspaceContext';
import { flushPaneFile } from '../pane-save';
import { NOTE_PANE_SNAPSHOT } from '../file-panes';

vi.mock('../localPersistence', () => ({ localPersistence: { getAllPendingSyncs: vi.fn().mockResolvedValue([]) } }));
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', { querySelectorAll: () => [] });
  const state = {
    view: 'notes', activeNote: { id: 1, uid: 'note', content: '<p>Saved</p>' },
    isReadOnlyFile: () => false, cancelPendingNoteSaves: vi.fn(), setIsLocalSaving: vi.fn(),
    saveNote: vi.fn().mockResolvedValue(true), flushPendingSaves: vi.fn().mockResolvedValue(undefined), syncDrafts: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceContextValue;
  target.addEventListener(NOTE_PANE_SNAPSHOT, event => { (event as CustomEvent).detail.content = '<p>Latest keystroke</p>'; });
  return state;
}

describe('COL-006 Notes editor handoff', () => {
  it('saves the editor snapshot before disposing the panel, preserving the existing save path', async () => {
    const state = setup();
    await flushPaneFile(state);
    expect(state.saveNote).toHaveBeenCalledWith({ ...state.activeNote, content: '<p>Latest keystroke</p>' });
    expect(state.cancelPendingNoteSaves).toHaveBeenCalledOnce();
    expect(state.flushPendingSaves).not.toHaveBeenCalled();
    expect(vi.mocked(state.saveNote).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(state.syncDrafts).mock.invocationCallOrder[0]);
    expect(state.syncDrafts).toHaveBeenCalled();
  });
  it('retains the panel when the snapshot cannot be persisted', async () => {
    const state = setup();
    vi.mocked(state.saveNote).mockResolvedValue(false);
    await expect(flushPaneFile(state)).rejects.toThrow('Keep this panel open');
    expect(state.flushPendingSaves).not.toHaveBeenCalled();
    expect(state.syncDrafts).not.toHaveBeenCalled();
  });
  it('does not save a read-only Note through the editor snapshot path', async () => {
    const state = setup();
    state.isReadOnlyFile = () => true;
    await flushPaneFile(state);
    expect(state.saveNote).not.toHaveBeenCalled();
  });
});
