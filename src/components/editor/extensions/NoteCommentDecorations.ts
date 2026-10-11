import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

type State = { open: ReadonlySet<string>; hot: string | null };

export const noteCommentDecorationsKey = new PluginKey<State>('noteCommentDecorations');

/** Updates which anchors are highlighted (`open`) and which one is emphasised (`hot`, on hover or while its thread is open). */
export function setNoteCommentDecorations(editor: { view: { state: any; dispatch: (tr: any) => void } }, change: Partial<State>) {
  const tr = editor.view.state.tr.setMeta(noteCommentDecorationsKey, change).setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

/** Highlights the text of blocks that have an open comment thread. Decorations only: nothing is written to the document. */
export const NoteCommentDecorations = Extension.create({
  name: 'noteCommentDecorations',
  addProseMirrorPlugins() {
    return [new Plugin<State>({
      key: noteCommentDecorationsKey,
      state: {
        init: () => ({ open: new Set<string>(), hot: null }),
        apply: (tr, value) => {
          const change = tr.getMeta(noteCommentDecorationsKey) as Partial<State> | undefined;
          return change ? { ...value, ...change } : value;
        },
      },
      props: {
        decorations(state) {
          const { open, hot } = noteCommentDecorationsKey.getState(state)!;
          if (!open.size) return DecorationSet.empty;
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            const id = node.attrs.commentAnchorId;
            if (!id || !open.has(id) || node.nodeSize <= 2) return;
            decorations.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, {
              class: id === hot ? 'note-comment-block is-hot' : 'note-comment-block',
            }));
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    })];
  },
});
