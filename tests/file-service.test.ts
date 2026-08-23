import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDocumentKind, listSupportedFiles, readDocument } from '../src/main/file-service';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('file service', () => {
  it('recognizes Markdown and Mermaid extensions case-insensitively', () => {
    expect(getDocumentKind('README.MD')).toBe('markdown');
    expect(getDocumentKind('flow.MERMAID')).toBe('mermaid');
    expect(getDocumentKind('notes.txt')).toBeNull();
  });

  it('lists supported files in alphabetical order', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orbit-'));
    tempDirectories.push(directory);
    await writeFile(path.join(directory, 'zeta.md'), '# Z');
    await writeFile(path.join(directory, 'alpha.mmd'), 'flowchart TD\n A-->B');
    await writeFile(path.join(directory, 'ignore.txt'), 'no');
    expect(await listSupportedFiles(directory)).toMatchObject([
      { name: 'alpha.mmd', kind: 'mermaid' },
      { name: 'zeta.md', kind: 'markdown' },
    ]);
  });

  it('reads a document with normalized metadata', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orbit-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'guide.md');
    await writeFile(filePath, '# Hello');
    const document = await readDocument(filePath);
    expect(document).toMatchObject({ name: 'guide.md', kind: 'markdown', content: '# Hello' });
    expect(document.path).toBe(path.resolve(filePath));
    expect(document.updatedAt).toBeGreaterThan(0);
  });
});
