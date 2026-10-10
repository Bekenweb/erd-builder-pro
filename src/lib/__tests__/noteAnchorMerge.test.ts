import { describe, expect, it } from 'vitest';
import { mergeServerCommentAnchors } from '../noteAnchorMerge';

describe('mergeServerCommentAnchors', () => {
  const server = '<p>Intro</p><p data-comment-anchor-id="a1">Body text</p>';

  it('copies a new anchor onto the creator content, even after the creator typed elsewhere', () => {
    expect(mergeServerCommentAnchors(server, '<p>Intro edited</p><p>Body text</p>'))
      .toBe('<p>Intro edited</p><p data-comment-anchor-id="a1">Body text</p>');
  });

  it('leaves content alone when the creator already has the anchor', () => {
    const draft = '<p>Intro</p><p data-comment-anchor-id="a1">Body text</p><p>More</p>';
    expect(mergeServerCommentAnchors(server, draft)).toBe(draft);
  });

  it('gives up when the anchored block was edited or removed', () => {
    expect(mergeServerCommentAnchors(server, '<p>Intro</p><p>Body changed</p>')).toBeNull();
    expect(mergeServerCommentAnchors(server, '<p>Intro</p>')).toBeNull();
  });

  it('keeps headings and the tag type', () => {
    expect(mergeServerCommentAnchors('<h2 data-comment-anchor-id="h">Title</h2>', '<p>Title</p><h2>Title</h2>'))
      .toBe('<p>Title</p><h2 data-comment-anchor-id="h">Title</h2>');
  });
});
