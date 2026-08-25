import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSolutionFile } from '../src/main/lsp-manager';

describe('findSolutionFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lsp-manager-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds a .sln at the workspace root', async () => {
    await writeFile(path.join(dir, 'MyApp.sln'), '');

    expect(findSolutionFile(dir)).toBe(path.join(dir, 'MyApp.sln'));
  });

  it('finds a .sln nested a couple of directories down', async () => {
    const nested = path.join(dir, 'src', 'MyApp');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'MyApp.sln'), '');

    expect(findSolutionFile(dir)).toBe(path.join(nested, 'MyApp.sln'));
  });

  it('returns undefined when there is no .sln anywhere within the search depth', async () => {
    await writeFile(path.join(dir, 'Program.cs'), 'class Program {}');

    expect(findSolutionFile(dir)).toBeUndefined();
  });

  it('does not descend into node_modules, .git, bin, or obj', async () => {
    for (const ignored of ['node_modules', '.git', 'bin', 'obj']) {
      const ignoredDir = path.join(dir, ignored);
      await mkdir(ignoredDir, { recursive: true });
      await writeFile(path.join(ignoredDir, 'Decoy.sln'), '');
    }

    expect(findSolutionFile(dir)).toBeUndefined();
  });

  it('prefers the root-level .sln over one further down', async () => {
    await writeFile(path.join(dir, 'Root.sln'), '');
    const nested = path.join(dir, 'src');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'Nested.sln'), '');

    expect(findSolutionFile(dir)).toBe(path.join(dir, 'Root.sln'));
  });
});
