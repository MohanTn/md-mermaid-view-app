import { describe, expect, it } from 'vitest';
import { normalizeMermaidSource, renderMarkdown, renderMermaid } from '../src/renderer/markdown';

describe('renderer formatting', () => {
  it('renders Markdown and removes unsafe HTML', () => {
    const html = renderMarkdown('# Hello\n\n<script>alert(1)</script>\n\n**bold**');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<script>');
  });

  it('turns Mermaid fences into diagram placeholders', () => {
    const html = renderMarkdown('```mermaid\nflowchart TD\n A-->B\n```');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain(encodeURIComponent('flowchart TD\n A-->B'));
  });

  it('normalizes BOM and optional Mermaid code fences', () => {
    expect(normalizeMermaidSource('\uFEFF```mermaid\nflowchart LR\n A-->B\n```')).toBe('flowchart LR\n A-->B');
  });

  it('creates a Mermaid placeholder for standalone diagrams', () => {
    expect(renderMermaid('flowchart LR\n A-->B')).toContain(`data-diagram="${encodeURIComponent('flowchart LR\n A-->B')}"`);
  });
});
