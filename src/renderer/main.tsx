import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import mermaid from 'mermaid';
import type { MermaidConfig } from 'mermaid';
import type { FileDocument, FileEntry, ParquetDocument } from '../shared/types';
import { addToHistory, directoryName, groupHistory, readHistory, type HistoryEntry } from './history';
import { ParquetTable } from './parquet-table';
import { normalizeMermaidSource, renderMarkdown, renderMermaid } from './markdown';
import { PomodoroTimer } from './pomodoro';
import {
  extractSubgraphs,
  findNodeLine,
  formatCommentsForClipboard,
  nodeIdFromDomId,
  parseSidecar,
  serializeSidecar,
  sidecarFileName,
  type DiagramComment,
} from './diagram-comments';
import { panBy, resetTransform, wheelDeltaToPixels, zoomAt, type ViewTransform } from './zoom-pan';
import './styles.css';

const THEME_KEY = 'md-mermaid-viewer-theme';
const PANEL_WIDTH_KEY = 'md-mermaid-viewer-panel-width';
const MIN_PANEL = 140;
const MAX_PANEL = 480;
type Theme = 'dark' | 'light';

function isParquetPath(filePath: string): boolean {
  return /\.parquet$/i.test(filePath);
}

function mermaidConfig(theme: Theme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
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
  };
}

// Dark mode is the default; keep the chosen theme across restarts.
mermaid.initialize(mermaidConfig('dark'));

function App(): React.JSX.Element {
  const [document, setDocument] = useState<FileDocument | ParquetDocument | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return saved >= MIN_PANEL && saved <= MAX_PANEL ? saved : 220;
  });
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'));
  const [comments, setComments] = useState<DiagramComment[]>([]);
  const [commentTag, setCommentTag] = useState('review');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editor, setEditor] = useState<{ id: string; line: number; x: number; y: number; initial: string } | null>(null);
  const [transform, setTransform] = useState<ViewTransform>(() => resetTransform());
  const [isPanning, setIsPanning] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panOrigin = useRef({ x: 0, y: 0 });
  const panStart = useRef<ViewTransform>(resetTransform());
  const panMovedRef = useRef(false);
  const draggingRef = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(220);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number } | null>(null);
  const editorTextRef = useRef<HTMLTextAreaElement>(null);
  const documentRef = useRef<FileDocument | ParquetDocument | null>(null);
  documentRef.current = document;
  const commentsRef = useRef<DiagramComment[]>([]);
  commentsRef.current = comments;
  const tagRef = useRef(commentTag);
  tagRef.current = commentTag;

  const loadFile = useCallback(async (filePath: string) => {
    try {
      setError('');
      // Parquet files are binary and need the dedicated reader; everything
      // else goes through the text-based document reader.
      const loaded = isParquetPath(filePath)
        ? await window.viewer.openParquet(filePath)
        : await window.viewer.openPath(filePath);
      setDocument(loaded);
      setTransform(resetTransform());
      setEditor(null);
      // Comments are diagram-only; close the panel for data files.
      if (loaded.kind === 'parquet') setCommentsOpen(false);
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

  // Load comments from the companion file `<name>_<tag>.txt` for the current document.
  useEffect(() => {
    let cancelled = false;
    if (!document || document.kind === 'parquet') {
      setComments([]);
      return () => { cancelled = true; };
    }
    void window.viewer.readSidecar(document.path, commentTag).then((content) => {
      if (!cancelled) setComments(parseSidecar(content));
    });
    return () => { cancelled = true; };
  }, [document, commentTag]);

  function persistComments(next: DiagramComment[]): void {
    setComments(next);
    const doc = documentRef.current;
    if (!doc) return;
    void window.viewer.writeSidecar(doc.path, tagRef.current, serializeSidecar(next)).catch((writeError) => {
      setError(writeError instanceof Error ? writeError.message : String(writeError));
    });
  }

  function addComment(id: string, line: number, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const existing = commentsRef.current.find((comment) => comment.id === id && comment.line === line);
    const next = existing
      ? commentsRef.current.map((comment) => (comment === existing ? { ...comment, text: trimmed } : comment))
      : [...commentsRef.current, { id, line, text: trimmed }];
    persistComments(next);
  }

  function removeComment(id: string, line: number): void {
    persistComments(commentsRef.current.filter((comment) => !(comment.id === id && comment.line === line)));
  }

  async function copyComments(): Promise<void> {
    const doc = documentRef.current;
    if (!doc || commentsRef.current.length === 0) return;
    await window.viewer.copyText(formatCommentsForClipboard(commentsRef.current, doc.name));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function openCommentEditor(id: string, line: number, element: SVGGElement): void {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    setEditor({
      id,
      line,
      x: Math.max(4, Math.min(rect.left - viewportRect.left, viewportRect.width - 260)),
      y: rect.bottom - viewportRect.top + 8,
      initial: commentsRef.current.find((comment) => comment.id === id && comment.line === line)?.text ?? '',
    });
  }

  function attachNodeClickHandlers(container: HTMLElement, source: string): void {
    const subgraphs = extractSubgraphs(source);
    const subgraphByTitle = new Map(subgraphs.map((subgraph) => [subgraph.title, subgraph]));
    container.querySelectorAll<SVGGElement>('g.node, g.cluster').forEach((g) => {
      g.addEventListener('click', (event) => {
        event.stopPropagation();
        if (panMovedRef.current) return;
        let id: string | null = null;
        if (g.classList.contains('cluster')) {
          const label = (g.querySelector('.cluster-label, foreignObject, text')?.textContent ?? '').trim();
          id = subgraphByTitle.get(label)?.id ?? null;
        } else {
          id = nodeIdFromDomId(g.id);
        }
        if (!id) return;
        const line = findNodeLine(source, id);
        if (line !== null) openCommentEditor(id, line, g);
      });
    });
  }

  function saveEditorComment(): void {
    if (!editor) return;
    addComment(editor.id, editor.line, editorTextRef.current?.value ?? '');
    setEditor(null);
  }

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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setCollapsed((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Apply the theme class before paint (no light-mode flash on startup).
  useLayoutEffect(() => {
    window.document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Memoize the HTML payload: recreating this object on every render makes
  // React 19 re-apply innerHTML on unrelated re-renders (e.g. the file list
  // refresh), which wipes out the DOM Mermaid is drawing into mid-render.
  // The theme is part of the payload identity so switching themes re-renders
  // diagrams with the matching Mermaid theme.
  const renderedHtml = useMemo(() => ({
    __html: document && document.kind !== 'parquet'
      ? (document.kind === 'mermaid' ? renderMermaid(document.content) : renderMarkdown(document.content))
      : '',
  }), [document, theme]);

  useEffect(() => {
    const renderDiagrams = async () => {
      if (!previewRef.current || document?.kind === 'parquet') return;
      // Mermaid sizes nodes from measured text; if fonts are still loading the
      // boxes come out too small and neighboring nodes end up overlapping.
      await window.document.fonts.ready;
      mermaid.initialize(mermaidConfig(theme));
      const nodes = Array.from(previewRef.current.querySelectorAll<HTMLElement>('.mermaid'));
      await Promise.all(nodes.map(async (node) => {
        try {
          const source = normalizeMermaidSource(decodeURIComponent(node.dataset.diagram ?? ''));
          node.classList.add('mermaid-rendering');
          node.textContent = source;
          await mermaid.run({ nodes: [node] });
          node.classList.remove('mermaid-rendering');
          if (!node.querySelector('svg')) throw new Error('Mermaid returned no SVG output.');
          attachNodeClickHandlers(node, source);
          applyCommentHighlights(node, source, commentsRef.current);
        } catch (renderError) {
          node.className = 'mermaid mermaid-error';
          const wrapped = renderError as { str?: string; message?: string } | undefined;
          const message = renderError instanceof Error ? renderError.message : wrapped?.str ?? wrapped?.message ?? 'Unable to render diagram.';
          node.replaceChildren(window.document.createTextNode(message));
        }
      }));
    };
    void renderDiagrams();
  }, [document, theme]);

  function applyCommentHighlights(container: HTMLElement, source: string, commentList: DiagramComment[]): void {
    const subgraphs = extractSubgraphs(source);
    const subgraphByTitle = new Map(subgraphs.map((subgraph) => [subgraph.title, subgraph.id]));
    container.querySelectorAll<SVGGElement>('g.node, g.cluster').forEach((g) => {
      let id: string | null = null;
      if (g.classList.contains('cluster')) {
        const label = (g.querySelector('.cluster-label, foreignObject, text')?.textContent ?? '').trim();
        id = subgraphByTitle.get(label) ?? null;
      } else {
        id = nodeIdFromDomId(g.id);
      }
      g.classList.toggle('has-comment', id !== null && commentList.some((comment) => comment.id === id));
    });
  }

  // Re-apply comment highlights whenever comments change (without re-rendering).
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>('.mermaid').forEach((node) => {
      applyCommentHighlights(node, normalizeMermaidSource(decodeURIComponent(node.dataset.diagram ?? '')), comments);
    });
  }, [comments, document]);

  // Wheel: plain scroll (trackpad two-finger / mouse wheel) pans the document;
  // Ctrl/Cmd + wheel (trackpad pinch) zooms around the cursor.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      // The Parquet table scrolls natively; leave its wheel events alone.
      if (documentRef.current?.kind === 'parquet') return;
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
    try {
      const selected = await window.viewer.chooseFile();
      if (selected) await loadFile(selected.path);
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    }
  }

  function zoomAtCenter(factor: number): void {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setTransform((current) => zoomAt(current, rect.width / 2, rect.height / 2, factor));
  }

  // Two-finger pinch zooms around the midpoint of the touches; a single
  // pointer pans when zoomed in. Mouse text selection is preserved at 1:1.
  function beginPan(event: React.PointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, select, textarea')) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) };
      setIsPanning(true);
    } else if (pointersRef.current.size === 1 && transform.scale > 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      panOrigin.current = { x: event.clientX, y: event.clientY };
      panStart.current = transform;
      panMovedRef.current = false;
      setIsPanning(true);
    }
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>): void {
    const point = pointersRef.current.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const points = [...pointersRef.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const newDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const midpointX = (points[0].x + points[1].x) / 2 - rect.left;
      const midpointY = (points[0].y + points[1].y) / 2 - rect.top;
      const factor = newDistance / pinchRef.current.distance;
      pinchRef.current.distance = newDistance;
      // Zooming around the live midpoint keeps the pinch spot anchored and
      // implicitly pans as the fingers move.
      setTransform((current) => zoomAt(current, midpointX, midpointY, factor));
      panMovedRef.current = true;
    } else if (pointersRef.current.size === 1 && isPanning) {
      if (Math.abs(event.clientX - panOrigin.current.x) + Math.abs(event.clientY - panOrigin.current.y) > 4) {
        panMovedRef.current = true;
      }
      setTransform({
        ...panStart.current,
        x: panStart.current.x + (event.clientX - panOrigin.current.x),
        y: panStart.current.y + (event.clientY - panOrigin.current.y),
      });
    }
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>): void {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // --- Panel resize ---
  function onResizeDown(event: ReactPointerEvent): void {
    event.preventDefault();
    draggingRef.current = true;
    dragStartX.current = event.clientX;
    dragStartW.current = panelWidth;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }
  function onResizeMove(event: ReactPointerEvent): void {
    if (!draggingRef.current) return;
    const next = Math.max(MIN_PANEL, Math.min(MAX_PANEL, dragStartW.current + (event.clientX - dragStartX.current)));
    setPanelWidth(next);
  }
  function onResizeUp(event: ReactPointerEvent): void {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }

  return (
    <main className={collapsed ? 'app collapsed' : 'app'} style={collapsed ? undefined : { gridTemplateColumns: `${panelWidth}px 4px minmax(0, 1fr)` }}>
      {!collapsed && (
      <aside className="file-list">
        <div className="file-list-header">{directory ? directory.split(/[\\/]/).pop() : 'Files'}</div>
        <div className="file-list-body">
          {files.map((file) => (
            <button key={file.path} className={`file-item ${document?.path === file.path ? 'selected' : ''}`} onClick={() => void loadFile(file.path)} title={file.path}>
              {file.name}
            </button>
          ))}
          {files.length === 0 && <p className="file-list-empty">No .md, .mmd, or .parquet files here.</p>}
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
      )}
      {!collapsed && <div className="resize-handle" onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} onPointerCancel={onResizeUp} />}
      <section className="viewer">
        <header className="toolbar">
          <button className={`panel-toggle ${collapsed ? 'is-collapsed' : ''}`} onClick={() => setCollapsed((current) => !current)} title={collapsed ? 'Show file list (Ctrl+B)' : 'Hide file list (Ctrl+B)'} aria-label={collapsed ? 'Show file list' : 'Hide file list'} aria-expanded={!collapsed}>
            {collapsed ? '▶' : '◀'}
          </button>
          <span className="toolbar-file" title={document?.path}>{document ? document.name : 'No file open'}</span>
          <PomodoroTimer />
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle dark mode"
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          {document && document.kind !== 'parquet' && (
            <div className="zoom-controls" role="group" aria-label="Zoom controls">
              <button className="zoom-button" onClick={() => zoomAtCenter(1.25)} title="Zoom in (Ctrl++)">＋</button>
              <span className="zoom-level">{Math.round(transform.scale * 100)}%</span>
              <button className="zoom-button" onClick={() => zoomAtCenter(0.8)} title="Zoom out (Ctrl+-)">−</button>
              <button className="zoom-button" onClick={() => setTransform(resetTransform())} title="Reset zoom (Ctrl+0)">1:1</button>
            </div>
          )}
          {document && document.kind !== 'parquet' && (
          <button className={`comments-button ${commentsOpen ? 'active' : ''}`} onClick={() => setCommentsOpen((current) => !current)} title="Add comments to the diagram (sidecar file)">
            Comments{comments.length > 0 ? ` (${comments.length})` : ''}
          </button>
          )}
          <button className="open-button" onClick={() => void chooseFile()} title="Open file (Ctrl+O)">Open…</button>
        </header>
        {commentsOpen && document && (
          <aside className="comments-panel">
            <div className="comments-panel-header">
              <span>Comments</span>
              <button className="comments-close" onClick={() => setCommentsOpen(false)} aria-label="Close comments panel">×</button>
            </div>
            <label className="comments-tag">
              <span>Tag</span>
              <input value={commentTag} onChange={(event) => setCommentTag(event.target.value)} spellCheck={false} />
            </label>
            <div className="comments-file" title={`${document.name}_${commentTag}.txt`}>↗ {sidecarFileName(document.name, commentTag)}</div>
            <div className="comments-list">
              {comments.map((comment, index) => (
                <div key={`${comment.id}-${comment.line}-${index}`} className="comment-item">
                  <div className="comment-item-head">
                    <span className="comment-id">{comment.id}</span>
                    <span className="comment-line">line {comment.line}</span>
                    <button className="comment-remove" onClick={() => removeComment(comment.id, comment.line)} title="Remove comment">×</button>
                  </div>
                  <div className="comment-text">{comment.text}</div>
                </div>
              ))}
              {comments.length === 0 && <p className="comments-empty">Click a module in the diagram to attach a comment.</p>}
            </div>
            <button className="comments-copy" onClick={() => void copyComments()} disabled={comments.length === 0}>
              {copied ? 'Copied ✓' : 'Copy comments'}
            </button>
          </aside>
        )}
        {error && <div className="error-banner">{error}</div>}
        {document?.kind === 'parquet'
          ? <ParquetTable key={document.path} document={document} onError={setError} />
          : (
          <div ref={viewportRef} className={`canvas-viewport ${isPanning ? 'is-panning' : ''}`} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
            {document
              ? <article ref={previewRef} className="document" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} dangerouslySetInnerHTML={renderedHtml} />
              : <div className="empty">Open a Markdown, Mermaid, or Parquet file (File ▸ Open… or Ctrl+O).</div>}
            {editor && (
              <div className="comment-editor" style={{ left: editor.x, top: editor.y }}>
                <div className="comment-editor-title">{editor.id} · line {editor.line}</div>
                <textarea
                  ref={editorTextRef}
                  defaultValue={editor.initial}
                  rows={2}
                  autoFocus
                  placeholder={`Comment on ${editor.id}…`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      saveEditorComment();
                    }
                    if (event.key === 'Escape') setEditor(null);
                  }}
                />
                <div className="comment-editor-actions">
                  <button onClick={saveEditorComment}>Save</button>
                  <button onClick={() => setEditor(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
