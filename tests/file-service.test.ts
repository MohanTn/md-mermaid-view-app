import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDocumentKind, listSupportedFiles, readDocument, readSidecar, sidecarPath, writeSidecar } from '../src/main/file-service';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('file service', () => {
  it('recognizes Markdown, Mermaid, and Parquet extensions case-insensitively', () => {
    expect(getDocumentKind('README.MD')).toBe('markdown');
    expect(getDocumentKind('flow.MERMAID')).toBe('mermaid');
    expect(getDocumentKind('data.parquet')).toBe('parquet');
    expect(getDocumentKind('notes.txt')).toBeNull();
  });

  it('lists supported files in alphabetical order', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orbit-'));
    tempDirectories.push(directory);
    await writeFile(path.join(directory, 'zeta.md'), '# Z');
    await writeFile(path.join(directory, 'alpha.mmd'), 'flowchart TD\n A-->B');
    await writeFile(path.join(directory, 'data.parquet'), 'not a real parquet file');
    await writeFile(path.join(directory, 'ignore.txt'), 'no');
    expect(await listSupportedFiles(directory)).toMatchObject([
      { name: 'alpha.mmd', kind: 'mermaid' },
      { name: 'data.parquet', kind: 'parquet' },
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

  it('names sidecar files `<name>_<tag>.txt` next to the source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orbit-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'system.mmd');
    expect(sidecarPath(filePath, 'review')).toBe(path.join(directory, 'system.mmd_review.txt'));
    expect(sidecarPath(filePath, 'a/b')).toBe(path.join(directory, 'system.mmd_a_b.txt'));
  });

  it('round-trips sidecar files and reads missing ones as empty', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orbit-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'system.mmd');
    expect(await readSidecar(filePath, 'review')).toBe('');
    await writeSidecar(filePath, 'review', '[P4] (line 2): tighten spacing\n');
    expect(await readSidecar(filePath, 'review')).toBe('[P4] (line 2): tighten spacing\n');
  });
});
