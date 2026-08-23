import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import mermaid from 'mermaid';
import type { FileDocument, FileEntry } from '../shared/types';
import { addToHistory, directoryName, groupHistory, readHistory, type HistoryEntry } from './history';
import { normalizeMermaidSource, renderMarkdown, renderMermaid } from './markdown';
import { panBy, resetTransform, wheelDeltaToPixels, zoomAt, type ViewTransform } from './zoom-pan';
import './styles.css';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  flowchart: {
    // Generous spacing keeps text-heavy diagrams from packing nodes together.
    // Small cluster padding + wide node spacing prevents subgraph boxes from
    // overlapping (Mermaid draws cluster padding outside dagre's layout box).
    padding: 8,
    nodeSpacing: 160,
    rankSpacing: 150,
    useMaxWidth: true,
    htmlLabels: true,
  },
});

function App(): React.JSX.Element {
  const [document, setDocument] = useState<FileDocument | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  const [transform, setTransform] = useState<ViewTransform>(() => resetTransform());
  const [isPanning, setIsPanning] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panOrigin = useRef({ x: 0, y: 0 });
  const panStart = useRef<ViewTransform>(resetTransform());

  const loadFile = useCallback(async (filePath: string) => {
    try {
      setError('');
      const loaded = await window.viewer.openPath(filePath);
      setDocument(loaded);
      setTransform(resetTransform());
      setHistory(addToHistory({ path: loaded.path, name: loaded.name, kind: loaded.kind }));
      const fileDirectory = loaded.path.replace(/[\\/][^\\/]+$/, '');
      setDirectory(fileDirectory);
      setFiles(await window.viewer.listDirectory(fileDirectory));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  // A file opened from the operating system (double-click, open-with).
  useEffect(() => {
    return window.viewer.onOpenPath((filePath: string) => {
      void loadFile(filePath);
    });
  }, [loadFile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void chooseFile();
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoomAtCenter(1.25);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '-') {
        event.preventDefault();
        zoomAtCenter(0.8);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '0') {
        event.preventDefault();
        setTransform(resetTransform());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Memoize the HTML payload: recreating this object on every render makes
  // React 19 re-apply innerHTML on unrelated re-renders (e.g. the file list
  // refresh), which wipes out the DOM Mermaid is drawing into mid-render.
  const renderedHtml = useMemo(() => ({
    __html: document ? (document.kind === 'mermaid' ? renderMermaid(document.content) : renderMarkdown(document.content)) : '',
  }), [document]);

  useEffect(() => {
    const renderDiagrams = async () => {
      if (!previewRef.current) return;
      // Mermaid sizes nodes from measured text; if fonts are still loading the
      // boxes come out too small and neighboring nodes end up overlapping.
      await window.document.fonts.ready;
      const nodes = Array.from(previewRef.current.querySelectorAll<HTMLElement>('.mermaid'));
      await Promise.all(nodes.map(async (node) => {
        try {
          const source = normalizeMermaidSource(decodeURIComponent(node.dataset.diagram ?? ''));
          node.classList.add('mermaid-rendering');
          node.textContent = source;
          await mermaid.run({ nodes: [node] });
          node.classList.remove('mermaid-rendering');
          if (!node.querySelector('svg')) throw new Error('Mermaid returned no SVG output.');
        } catch (renderError) {
          node.className = 'mermaid mermaid-error';
          const wrapped = renderError as { str?: string; message?: string } | undefined;
          const message = renderError instanceof Error ? renderError.message : wrapped?.str ?? wrapped?.message ?? 'Unable to render diagram.';
          node.replaceChildren(window.document.createTextNode(message));
        }
      }));
    };
    void renderDiagrams();
  }, [document]);

  // Wheel: plain scroll (trackpad two-finger / mouse wheel) pans the document;
  // Ctrl/Cmd + wheel (trackpad pinch) zooms around the cursor.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        const pixels = wheelDeltaToPixels(event.deltaY, event.deltaMode, rect.height);
        setTransform((current) => zoomAt(current, px, py, Math.exp(-pixels * 0.002)));
      } else {
        const dx = wheelDeltaToPixels(event.deltaX, event.deltaMode, rect.width);
        const dy = wheelDeltaToPixels(event.deltaY, event.deltaMode, rect.height);
        setTransform((current) => panBy(current, -dx, -dy));
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  async function chooseFile(): Promise<void> {
    const selected = await window.viewer.chooseFile();
    if (selected) await loadFile(selected.path);
  }

  function zoomAtCenter(factor: number): void {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setTransform((current) => zoomAt(current, rect.width / 2, rect.height / 2, factor));
  }

  function beginPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (transform.scale <= 1) return; // leave text selection alone at 1:1
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, select, textarea')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panOrigin.current = { x: event.clientX, y: event.clientY };
    panStart.current = transform;
    setIsPanning(true);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>): void {
    if (!isPanning) return;
    setTransform({
      ...panStart.current,
      x: panStart.current.x + (event.clientX - panOrigin.current.x),
      y: panStart.current.y + (event.clientY - panOrigin.current.y),
    });
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
  }

  return (
    <main className="app">
      <aside className="file-list">
        <div className="file-list-header">{directory ? directory.split(/[\\/]/).pop() : 'Files'}</div>
        <div className="file-list-body">
          {files.map((file) => (
            <button key={file.path} className={`file-item ${document?.path === file.path ? 'selected' : ''}`} onClick={() => void loadFile(file.path)} title={file.path}>
              {file.name}
            </button>
          ))}
          {files.length === 0 && <p className="file-list-empty">No .md or .mmd files here.</p>}
        </div>
        <div className="history-section">
          <div className="history-header">Recent</div>
          <div className="history-body">
            {groupHistory(history).map((group) => (
              <div key={group.directory} className="history-group">
                <div className="history-group-header" title={group.directory}>
                  {group.directory ? directoryName(group.directory) : '(no folder)'}
                  <span className="history-group-count">{group.entries.length}</span>
                </div>
                {group.entries.map((entry) => (
                  <button key={entry.path} className={`file-item history-item ${document?.path === entry.path ? 'selected' : ''}`} onClick={() => void loadFile(entry.path)} title={entry.path}>
                    <span className="history-item-name">{entry.name}</span>
                    <span className="history-item-path">{group.directory}</span>
                  </button>
                ))}
              </div>
            ))}
            {history.length === 0 && <p className="file-list-empty">Opened files will appear here.</p>}
          </div>
        </div>
      </aside>
      <section className="viewer">
        <header className="toolbar">
          <span className="toolbar-file" title={document?.path}>{document ? document.name : 'No file open'}</span>
          {document && (
            <div className="zoom-controls" role="group" aria-label="Zoom controls">
              <button className="zoom-button" onClick={() => zoomAtCenter(1.25)} title="Zoom in (Ctrl++)">＋</button>
              <span className="zoom-level">{Math.round(transform.scale * 100)}%</span>
              <button className="zoom-button" onClick={() => zoomAtCenter(0.8)} title="Zoom out (Ctrl+-)">−</button>
              <button className="zoom-button" onClick={() => setTransform(resetTransform())} title="Reset zoom (Ctrl+0)">1:1</button>
            </div>
          )}
          <button className="open-button" onClick={() => void chooseFile()} title="Open file (Ctrl+O)">Open…</button>
        </header>
        {error && <div className="error-banner">{error}</div>}
        <div ref={viewportRef} className={`canvas-viewport ${isPanning ? 'is-panning' : ''}`} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
          {document
            ? <article ref={previewRef} className="document" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} dangerouslySetInnerHTML={renderedHtml} />
            : <div className="empty">Open a Markdown or Mermaid file (File ▸ Open… or Ctrl+O).</div>}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
