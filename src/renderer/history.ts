const HISTORY_KEY = 'md-mermaid-viewer-history';
const MAX_HISTORY = 12;

export interface HistoryEntry {
  path: string;
  name: string;
  kind: 'markdown' | 'mermaid';
}

export function readHistory(storage: Storage = window.localStorage): HistoryEntry[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(isHistoryEntry).slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function addToHistory(entry: HistoryEntry, storage: Storage = window.localStorage): HistoryEntry[] {
  const next = [entry, ...readHistory(storage).filter((item) => item.path !== entry.path)].slice(0, MAX_HISTORY);
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export interface HistoryGroup {
  directory: string;
  entries: HistoryEntry[];
}

// Parent directory of a file path ('' when the path has no directory part).
export function directoryOf(path: string): string {
  const match = /[\\/][^\\/]+$/.exec(path);
  return match ? path.slice(0, match.index) : '';
}

export function directoryName(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, '');
  const match = /[\\/]([^\\/]+)$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

// Group history entries by their containing directory, preserving order,
// newest-first within each group and groups ordered by their newest entry.
export function groupHistory(history: HistoryEntry[]): HistoryGroup[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const key = directoryOf(entry.path);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return Array.from(groups.entries()).map(([directory, entries]) => ({ directory, entries }));
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<HistoryEntry>;
  return typeof item.path === 'string' && typeof item.name === 'string' && (item.kind === 'markdown' || item.kind === 'mermaid');
}
