import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentOutline } from './DocumentOutline';

describe('Notes heading navigation', () => {
  it('omits the rail for a document without headings', () => {
    expect(renderToStaticMarkup(createElement(DocumentOutline, { headings: [], scrollToHeading: () => {} }))).toBe('');
  });

  it('shows one line per heading, including nested headings with shorter lines', () => {
    const html = renderToStaticMarkup(createElement(DocumentOutline, { headings: [
      { text: 'Overview', level: 1, pos: 0 },
      { text: 'Details', level: 2, pos: 12 },
      { text: 'Example', level: 3, pos: 25 },
    ], scrollToHeading: () => {} }));
    expect(html).toContain('Document Outline: 3 headings');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toContain('width:20px');
    expect(html).toContain('width:17px');
    expect(html).toContain('width:14px');
  });
});
