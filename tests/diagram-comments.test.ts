import { describe, expect, it } from 'vitest';
import {
  extractSubgraphs,
  findNodeLine,
  formatCommentsForClipboard,
  nodeIdFromDomId,
  parseSidecar,
  serializeSidecar,
  sidecarFileName,
} from '../src/renderer/diagram-comments';

describe('diagram comments', () => {
  it('parses and serializes sidecar lines', () => {
    const comments = parseSidecar('[P4] (line 42): Tighten the spacing\n[B] (line 7): Add a retry path\n\nignored line\n');
    expect(comments).toEqual([
      { id: 'P4', line: 42, text: 'Tighten the spacing' },
      { id: 'B', line: 7, text: 'Add a retry path' },
    ]);
    expect(serializeSidecar(comments)).toBe('[P4] (line 42): Tighten the spacing\n[B] (line 7): Add a retry path\n');
    expect(serializeSidecar([])).toBe('');
  });

  it('formats the clipboard copy as module + line per comment', () => {
    const text = formatCommentsForClipboard(
      [
        { id: 'P4', line: 42, text: 'Tighten the spacing' },
        { id: 'B', line: 7, text: 'Add a retry path' },
      ],
      'system.mmd',
    );
    expect(text).toBe('P4 (system.mmd line 42): Tighten the spacing\nB (system.mmd line 7): Add a retry path');
  });

  it('finds the declaration line of a node id', () => {
    const source = 'flowchart TB\n  subgraph P4["Pipeline 4"]\n    A[Ingest] --> B[Train]\n  end\n  P4 --> C';
    expect(findNodeLine(source, 'P4')).toBe(2);
    expect(findNodeLine(source, 'A')).toBe(3);
    expect(findNodeLine(source, 'C')).toBe(5);
    expect(findNodeLine(source, 'Missing')).toBeNull();
    // token boundaries: "A" must not match inside "Train" or "P4"
    expect(findNodeLine('flowchart LR\n  DATA[Data] --> AX[Axis]', 'A')).toBeNull();
  });

  it('extracts subgraph ids, lines, and titles', () => {
    const source = 'flowchart TB\n  subgraph P4["Pipeline 4"]\n  end\n  subgraph P5[Pipeline 5]\n  end\n  subgraph P6\n  end';
    expect(extractSubgraphs(source)).toEqual([
      { id: 'P4', line: 2, title: 'Pipeline 4' },
      { id: 'P5', line: 4, title: 'Pipeline 5' },
      { id: 'P6', line: 6, title: '' },
    ]);
  });

  it('recovers node ids from mermaid DOM ids', () => {
    expect(nodeIdFromDomId('flowchart-A-1')).toBe('A');
    expect(nodeIdFromDomId('mermaid-123-flowchart-A-0')).toBe('A');
    expect(nodeIdFromDomId('flowchart-Module1-3')).toBe('Module1');
    expect(nodeIdFromDomId('flowchart-node-2-1')).toBe('node-2');
    expect(nodeIdFromDomId('subgraph-7')).toBeNull();
  });

  it('sanitizes the tag in sidecar file names', () => {
    expect(sidecarFileName('system.mmd', 'review')).toBe('system.mmd_review.txt');
    expect(sidecarFileName('system.mmd', 'a/b c')).toBe('system.mmd_a_b_c.txt');
    expect(sidecarFileName('system.mmd', '///')).toBe('system.mmd_notes.txt');
  });
});
