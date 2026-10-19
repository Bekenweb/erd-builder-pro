import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSave, type UseAutoSaveParams } from './useAutoSave';
import { flushWorkspaceEditors, PANE_FLUSH_CHILDREN } from '@/lib/file-panes';

vi.mock('react', () => ({ useEffect: vi.fn(), useRef: (value: unknown) => ({ current: value }) }));

function params(view: string): UseAutoSaveParams {
  return {
    view, isLocalSavingRef: { current: true },
    activeDiagramId: 'erd', activeNoteUid: 'note', activeDrawingId: 'drawing', activeFlowchartId: 'flowchart',
    notes: [{ uid: 'note' }], drawings: [{ id: 'drawing' }], flowcharts: [{ uid: 'flowchart' }],
    nodes: [], edges: [], viewportRef: { current: {} }, lastSaveCallRef: { current: 0 },
    notesSaveTimeoutRef: { current: null }, drawingsSaveTimeoutRef: { current: null }, flowchartsSaveTimeoutRef: { current: null },
    saveDiagram: vi.fn().mockResolvedValue(undefined), saveNote: vi.fn().mockResolvedValue(true),
    saveDrawing: vi.fn().mockResolvedValue(true), saveFlowchart: vi.fn().mockResolvedValue(true),
    setIsLocalSaving: vi.fn(), syncDrafts: vi.fn().mockResolvedValue(undefined),
  } as unknown as UseAutoSaveParams;
}

describe('SH-002 pending local save', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])('COL-006 saves the active panels without writing the shell snapshot (shell dirty: %s)', async dirty => {
    const state = params('notes');
    state.isLocalSavingRef.current = dirty;
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const savePane = vi.fn().mockResolvedValue(undefined);
    target.addEventListener(PANE_FLUSH_CHILDREN, event => (event as CustomEvent).detail.push(savePane()));
    await flushWorkspaceEditors(useAutoSave(state).flushPendingSaves);
    expect(savePane).toHaveBeenCalledOnce();
    expect(state.saveNote).not.toHaveBeenCalled();
    expect(state.syncDrafts).not.toHaveBeenCalled();
  });

  it('COL-006 refuses navigation if an open panel cannot save', async () => {
    const state = params('notes');
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    target.addEventListener(PANE_FLUSH_CHILDREN, event => (event as CustomEvent).detail.push(Promise.reject(new Error('Panel save failed'))));
    await expect(flushWorkspaceEditors(useAutoSave(state).flushPendingSaves)).rejects.toThrow('Panel save failed');
    expect(state.saveNote).not.toHaveBeenCalled();
  });

  it.each(['erd', 'notes', 'drawings', 'flowchart'])('preserves pending state when %s persistence fails', async view => {
    const state = params(view);
    for (const save of [state.saveDiagram, state.saveNote, state.saveDrawing, state.saveFlowchart]) vi.mocked(save).mockResolvedValue(false);
    await expect(useAutoSave(state).flushPendingSaves()).rejects.toThrow('Could not save');
    expect(state.setIsLocalSaving).not.toHaveBeenCalled();
    expect(state.syncDrafts).not.toHaveBeenCalled();
  });

  it('syncs only after persisting the pending note', async () => {
    const state = params('notes');
    await useAutoSave(state).flushPendingSaves();
    expect(state.saveNote).toHaveBeenCalledWith(state.notes[0]);
    expect(state.setIsLocalSaving).toHaveBeenCalledWith(false);
    expect(state.syncDrafts).toHaveBeenCalledOnce();
  });

  it('flushes a Drawing selected by its uid', async () => {
    const state = params('drawings');
    state.drawings = [{ id: 7, uid: 'drawing' }];
    await useAutoSave(state).flushPendingSaves();
    expect(state.saveDrawing).toHaveBeenCalledWith(state.drawings[0]);
  });
});
