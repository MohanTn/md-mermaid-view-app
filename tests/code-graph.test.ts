import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Track how document-symbol requests overlap in time, and which files were
// actually scanned, so the tests can assert on scanWorkspace's own
// scheduling/cancellation logic without needing a real LSP server.
let documentSymbolCalls: string[] = [];
let concurrentInFlight = 0;
let maxConcurrentInFlight = 0;

vi.mock('../src/main/lsp-manager', async () => {
  class FakeLspManager {
    private started = new Set<string>();
    async startServer(language: string): Promise<void> {
      this.started.add(language);
    }
    hasServer(language: string): boolean {
      return this.started.has(language);
    }
    openDocument(): void {
      // no-op
    }
    async getDocumentSymbols(_language: string, filePath: string) {
      documentSymbolCalls.push(filePath);
      concurrentInFlight++;
      maxConcurrentInFlight = Math.max(maxConcurrentInFlight, concurrentInFlight);
      await new Promise((r) => setTimeout(r, 30));
      concurrentInFlight--;

      // nested.ts exercises class/method nesting (see the "keeps nested
      // symbols under their parent" test) — every other file gets one flat
      // top-level symbol.
      if (path.basename(filePath) === 'nested.ts') {
        return [
          {
            name: 'Widget',
            kind: 5, // Class
            range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
            selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
            children: [
              {
                name: 'render',
                kind: 6, // Method
                range: { start: { line: 1, character: 2 }, end: { line: 3, character: 3 } },
                selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
              },
            ],
          },
        ];
      }

      // impl.ts declares a class that "extends Base" — used to check the
      // implements-vs-references heuristic in buildGraph. base.ts must
      // declare a symbol actually named "Base" for the detail-text match.
      if (path.basename(filePath) === 'impl.ts') {
        return [
          {
            name: 'Foo',
            kind: 5, // Class
            detail: 'class Foo extends Base',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
            selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          },
        ];
      }
      if (path.basename(filePath) === 'base.ts') {
        return [
          {
            name: 'Base',
            kind: 5, // Class
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          },
        ];
      }

      return [
        {
          name: path.basename(filePath),
          kind: 12,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        },
      ];
    }
    async getReferences(_language: string, filePath: string) {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);

      // consumer.ts's top-level symbol references provider.ts's.
      if (base === 'consumer.ts') {
        return [
          {
            uri: `file://${path.join(dir, 'provider.ts')}`,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          },
        ];
      }

      // impl.ts's Foo class references base.ts's top-level symbol (standing
      // in for the "Base" it extends).
      if (base === 'impl.ts') {
        return [
          {
            uri: `file://${path.join(dir, 'base.ts')}`,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          },
        ];
      }

      return [];
    }
    async getDefinition() {
      return null;
    }
    async shutdown(): Promise<void> {
      // no-op
    }
  }
  // Keep the real symbol-kind mapper — only the LSP process itself is faked
  // — so kind 5 actually maps to "class", which the implements-vs-references
  // heuristic in buildGraph depends on.
  const actual = await vi.importActual<typeof import('../src/main/lsp-manager')>(
    '../src/main/lsp-manager',
  );
  return {
    LspManager: FakeLspManager,
    mapSymbolKind: actual.mapSymbolKind,
  };
});

const { scanWorkspace } = await import('../src/main/code-graph');
const { SCAN_CANCELLED_MESSAGE } = await import('../src/shared/types');

describe('scanWorkspace', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'code-graph-test-'));
    documentSymbolCalls = [];
    concurrentInFlight = 0;
    maxConcurrentInFlight = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('scans files with overlapping requests instead of one at a time', async () => {
    for (let i = 0; i < 6; i++) {
      await writeFile(path.join(dir, `f${i}.ts`), `export function f${i}() {}`);
    }

    const doc = await scanWorkspace(dir);

    expect(doc.graph.nodes.length).toBeGreaterThan(0);
    expect(documentSymbolCalls.length).toBe(6);
    // A strictly sequential scan would never have more than one
    // getDocumentSymbols call in flight at once.
    expect(maxConcurrentInFlight).toBeGreaterThan(1);
  });

  it('stops scanning once the signal is aborted, and rejects with the cancellation message', async () => {
    for (let i = 0; i < 20; i++) {
      await writeFile(path.join(dir, `f${i}.ts`), `export function f${i}() {}`);
    }

    const controller = new AbortController();
    const scanPromise = scanWorkspace(dir, undefined, controller.signal);
    setTimeout(() => controller.abort(), 10);

    await expect(scanPromise).rejects.toThrow(SCAN_CANCELLED_MESSAGE);
    // Not every file should have been scanned — cancellation must stop new work.
    expect(documentSymbolCalls.length).toBeLessThan(20);
  });

  it('attaches a file\'s fields and methods to its own node as an indented member list', async () => {
    await writeFile(path.join(dir, 'nested.ts'), 'class Widget { render() {} }');

    const doc = await scanWorkspace(dir);

    // One node per file — members are attached to it, not scattered as
    // their own nodes (the earlier per-symbol graph collapsed a whole
    // workspace onto a single row once laid out as a tree; see the
    // "no exact file:file bug" note in the layout code for the history).
    expect(doc.graph.nodes).toHaveLength(1);
    const fileNode = doc.graph.nodes[0];
    expect(fileNode.type).toBe('file');

    const lines = fileNode.label.split('\n');
    const classLine = lines.find((l) => l.includes('Widget'))!;
    const methodLine = lines.find((l) => l.includes('render'))!;
    expect(classLine).toBeTruthy();
    expect(methodLine).toBeTruthy();
    // The nested method is indented deeper than its enclosing class.
    const leadingSpaces = (s: string) => s.length - s.trimStart().length;
    expect(leadingSpaces(methodLine)).toBeGreaterThan(leadingSpaces(classLine));
  });

  it('aggregates a cross-file symbol reference into one file-to-file "references" edge', async () => {
    await writeFile(path.join(dir, 'consumer.ts'), 'export function run() { provider(); }');
    await writeFile(path.join(dir, 'provider.ts'), 'export function provider() {}');

    const doc = await scanWorkspace(dir);

    const consumerNode = doc.graph.nodes.find((n) => n.filePath.endsWith('consumer.ts'));
    const providerNode = doc.graph.nodes.find((n) => n.filePath.endsWith('provider.ts'));
    expect(consumerNode && providerNode).toBeTruthy();

    const edge = doc.graph.edges.find(
      (e) => e.source === consumerNode!.id && e.target === providerNode!.id,
    );
    expect(edge?.type).toBe('references');
  });

  it('classifies a cross-file "extends" relationship as "implements" instead of "references"', async () => {
    await writeFile(path.join(dir, 'impl.ts'), 'class Foo extends Base {}');
    await writeFile(path.join(dir, 'base.ts'), 'export class Base {}');

    const doc = await scanWorkspace(dir);

    const implNode = doc.graph.nodes.find((n) => n.filePath.endsWith('impl.ts'));
    const baseNode = doc.graph.nodes.find((n) => n.filePath.endsWith('base.ts'));
    expect(implNode && baseNode).toBeTruthy();

    const edge = doc.graph.edges.find(
      (e) => e.source === implNode!.id && e.target === baseNode!.id,
    );
    expect(edge?.type).toBe('implements');
  });
});
