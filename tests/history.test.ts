import { describe, expect, it } from 'vitest';
import { addToHistory, directoryName, directoryOf, groupHistory, readHistory, type HistoryEntry } from '../src/renderer/history';

function createStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
}

const entry = (name: string, kind: HistoryEntry['kind'] = 'markdown'): HistoryEntry => ({ path: `/tmp/${name}`, name, kind });

describe('file history', () => {
  it('puts newest files first and removes duplicates', () => {
    const storage = createStorage();
    addToHistory(entry('one.md'), storage);
    addToHistory(entry('two.md'), storage);
    expect(addToHistory(entry('one.md'), storage).map((item) => item.name)).toEqual(['one.md', 'two.md']);
  });

  it('keeps at most twelve entries', () => {
    const storage = createStorage();
    for (let index = 0; index < 14; index += 1) addToHistory(entry(`${index}.md`), storage);
    expect(readHistory(storage)).toHaveLength(12);
    expect(readHistory(storage)[0].name).toBe('13.md');
  });

  it('ignores corrupt stored values', () => {
    const storage = createStorage();
    storage.setItem('md-mermaid-viewer-history', 'not json');
    expect(readHistory(storage)).toEqual([]);
  });
});

describe('grouped history', () => {
  it('groups entries by their containing directory', () => {
    const groups = groupHistory([
      { path: '/repo/a.md', name: 'a.md', kind: 'markdown' },
      { path: '/repo/b.md', name: 'b.md', kind: 'markdown' },
      { path: '/other/c.mmd', name: 'c.mmd', kind: 'mermaid' },
    ]);
    expect(groups.map((group) => group.directory)).toEqual(['/repo', '/other']);
    expect(groups[0].entries.map((entry) => entry.name)).toEqual(['a.md', 'b.md']);
  });

  it('keeps order and handles paths without a directory', () => {
    const groups = groupHistory([
      { path: '/repo/b.md', name: 'b.md', kind: 'markdown' },
      { path: 'top.mmd', name: 'top.mmd', kind: 'mermaid' },
    ]);
    expect(groups.map((group) => group.entries[0].name)).toEqual(['b.md', 'top.mmd']);
    expect(groups[0].directory).toBe('/repo');
    expect(groups[1].directory).toBe('');
  });

  it('derives directory and its display name', () => {
    expect(directoryOf('/home/user/repo/system.mmd')).toBe('/home/user/repo');
    expect(directoryName('/home/user/repo')).toBe('repo');
    expect(directoryName('/')).toBe('');
  });
});
