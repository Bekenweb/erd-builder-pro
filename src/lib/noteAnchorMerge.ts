// Comment anchors are added by other Team members while the creator keeps typing (DATA-004).
// Instead of making the creator reload, copy the server's anchors onto the creator's own content.

const BLOCK = /<(p|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const ANCHOR = /\sdata-comment-anchor-id="([^"]+)"/i;

const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

type Block = { tag: string; id: string; text: string };

function anchorsOf(html: string): Block[] {
  const blocks: Block[] = [];
  for (const match of html.matchAll(BLOCK)) {
    const id = match[2].match(ANCHOR)?.[1];
    if (id) blocks.push({ tag: match[1].toLowerCase(), id, text: textOf(match[3]) });
  }
  return blocks;
}

/**
 * Returns the creator's content carrying every anchor the server has, or null when an anchor cannot be placed
 * (its text changed or was removed). Null means a real conflict that the user must resolve.
 */
export function mergeServerCommentAnchors(serverHtml: string, draftHtml: string): string | null {
  const have = new Set(anchorsOf(draftHtml).map(block => block.id));
  const missing = anchorsOf(serverHtml).filter(block => !have.has(block.id));
  if (missing.length === 0) return draftHtml;

  let merged = draftHtml;
  for (const anchor of missing) {
    let placed = false;
    merged = merged.replace(BLOCK, (whole, tag: string, attrs: string, inner: string) => {
      if (placed || tag.toLowerCase() !== anchor.tag || ANCHOR.test(attrs) || textOf(inner) !== anchor.text) return whole;
      placed = true;
      return `<${tag}${attrs} data-comment-anchor-id="${anchor.id}">${inner}</${tag}>`;
    });
    if (!placed) return null;
  }
  return merged;
}
