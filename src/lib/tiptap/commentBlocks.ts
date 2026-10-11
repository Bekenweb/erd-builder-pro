import type { Editor } from '@tiptap/react';

/** Position of the paragraph or heading that holds `position` (list items and table cells hold paragraphs), or null. */
export function commentableBlockPosition(editor: Editor, position: number): number | null {
  const resolved = editor.state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth);
    if (node.type.name === 'paragraph' || node.type.name === 'heading') return resolved.before(depth);
  }
  return null;
}
