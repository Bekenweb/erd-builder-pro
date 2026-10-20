import type { WorkspaceContextValue } from '@/providers/WorkspaceContext';
import { assertNoCommentDraft, assertNoPendingReview, NOTE_PANE_SNAPSHOT } from './file-panes';
import { flushWorkspaceChanges } from './workspace-save';

export async function flushPaneFile(workspace: WorkspaceContextValue, container: ParentNode = document) {
  assertNoCommentDraft(container);
  assertNoPendingReview(container);
  const { view, activeNote, activeDiagram, activeFlowchart, activeDrawing } = workspace;
  const file = view === 'notes' ? activeNote : view === 'erd' ? activeDiagram : view === 'flowchart' ? activeFlowchart : activeDrawing;
  let capturedNote = false;
  if (view === 'notes' && activeNote && !workspace.isReadOnlyFile(activeNote)) {
    const snapshot = { uid: String(activeNote.uid ?? activeNote.id), content: null as string | null };
    window.dispatchEvent(new CustomEvent(NOTE_PANE_SNAPSHOT, { detail: snapshot }));
    if (snapshot.content !== null) {
      capturedNote = true;
      workspace.cancelPendingNoteSaves();
      if (snapshot.content !== activeNote.content && !await workspace.saveNote({ ...activeNote, content: snapshot.content })) throw new Error('Could not save the note. Keep this panel open and try again.');
      workspace.setIsLocalSaving(false);
    }
  }
  // The shell snapshot may predate Tiptap's pending keystroke.
  await flushWorkspaceChanges(capturedNote ? async () => {} : workspace.flushPendingSaves, workspace.syncDrafts, { type: view, id: file?.id, uid: file?.uid });
}
