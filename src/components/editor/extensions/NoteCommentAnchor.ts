import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const NoteCommentAnchor = Extension.create({
  name: 'noteCommentAnchor',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        commentAnchorId: {
          default: null,
          // Pressing Enter inside an anchored block must not copy its id: two blocks would share one comment thread.
          keepOnSplit: false,
          parseHTML: element => element.getAttribute('data-comment-anchor-id'),
          renderHTML: attributes => attributes.commentAnchorId
            ? { 'data-comment-anchor-id': attributes.commentAnchorId }
            : {},
        },
      },
    }];
  },
  // Tiptap only drops `keepOnSplit` attributes when Enter is pressed at the end of a block. A split at the start or in the
  // middle copies the id onto both halves, so after every change keep each id on the block that holds most of its text.
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('noteCommentAnchorUnique'),
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some(transaction => transaction.docChanged)) return null;

        const byId = new Map<string, Array<{ pos: number; size: number }>>();
        newState.doc.descendants((node, pos) => {
          const id = node.attrs.commentAnchorId;
          if (id) byId.set(id, [...(byId.get(id) ?? []), { pos, size: node.textContent.length }]);
        });

        const tr = newState.tr;
        for (const blocks of byId.values()) {
          if (blocks.length < 2) continue;
          const keeper = blocks.reduce((best, block) => (block.size > best.size ? block : best));
          for (const block of blocks) {
            if (block === keeper) continue;
            const node = newState.doc.nodeAt(block.pos);
            if (node) tr.setNodeMarkup(block.pos, undefined, { ...node.attrs, commentAnchorId: null });
          }
        }
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
      },
    })];
  },
});
