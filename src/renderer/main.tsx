import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { installBrowserViewer } from "./browser-viewer";
import type { FileDocument, FileEntry, ParquetDocument, CodeGraphDocument } from "../shared/types";
import { SCAN_CANCELLED_MESSAGE } from "../shared/types";
import { readHistory, type HistoryEntry } from "./history";
import { renderMarkdown, renderMermaid } from "./markdown";
import { resetTransform } from "./zoom-pan";
import { FileList } from "./components/file-list";
import { Toolbar } from "./components/toolbar";
import { CommentsPanel } from "./components/comments-panel";
import { ContentArea } from "./components/content-area";
import { useTheme } from "./hooks/use-theme";
import { usePanel } from "./hooks/use-panel";
import { usePanZoom } from "./hooks/use-pan-zoom";
import { useComments } from "./hooks/use-comments";
import { useFileLoader } from "./hooks/use-file-loader";
import { useMermaidRender } from "./hooks/use-mermaid-render";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import "./styles.css";

installBrowserViewer();

function App(): React.JSX.Element {
  // ─────────── Cross-cutting refs ───────────
  const previewRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // ─────────── Hooks (declaration order = dependency order) ───────────

  // 1. Theme — pure, no deps
  const { theme, toggleTheme } = useTheme();

  // 2. Panel chrome — pure, no deps
  const { collapsed, toggleCollapsed, panelWidth, handlePanelWidthChange } =
    usePanel();

  // 3. Document state (owned here; setters passed into file-loader)
  const [document, setDocument] = useState<
    FileDocument | ParquetDocument | CodeGraphDocument | null
  >(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");

  // Stable ref so pan-zoom and comments hooks can read the latest document
  // without re-creating their effects.
  const documentRef = useRef<FileDocument | ParquetDocument | CodeGraphDocument | null>(null);
  documentRef.current = document;

  // 4. Pan / zoom — depends on documentRef + viewportRef
  const {
    transform,
    setTransform,
    isPanning,
    zoomAtCenter,
    beginPan,
    movePan,
    endPan,
    panMovedRef,
  } = usePanZoom(documentRef, viewportRef);

  // 5. File loader — depends on set{Document,Files,History,Directory,Error}
  //    onFileOpened resets zoom + editor whenever a new file loads.
  const { loadFile, chooseFile } = useFileLoader({
    setDocument,
    setFiles,
    setHistory,
    setDirectory,
    setError,
    onFileOpened: () => {
      setTransform(resetTransform());
    },
  });

  const [isScanning, setIsScanning] = useState(false);

  // Open workspace for code graph
  const openWorkspace = async () => {
    setError("");
    setIsScanning(true);
    try {
      const result = await window.viewer.openWorkspace();
      if (result) {
        setDocument(result);
        setTransform(resetTransform());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open workspace.";
      // A user-initiated cancel isn't a failure — just drop back to the empty state quietly.
      if (message !== SCAN_CANCELLED_MESSAGE) setError(message);
    } finally {
      setIsScanning(false);
    }
  };

  const cancelWorkspaceScan = () => {
    void window.viewer.cancelScan();
  };

  // 6. Comments — depends on document/ref + setError + viewportRef
  const {
    comments,
    commentTag,
    setCommentTag,
    commentsOpen,
    setCommentsOpen,
    copied,
    editor,
    setEditor,
    addComment,
    removeComment,
    copyComments,
    openCommentEditor,
    saveEditorComment,
    commentsRef,
    editorTextRef,
  } = useComments({ document, documentRef, setError, viewportRef });

  // 7. Mermaid rendering — depends on document + theme + refs + callbacks
  useMermaidRender({
    document,
    theme,
    previewRef,
    commentsRef,
    panMovedRef,
    openCommentEditor,
    setError,
  });

  // 8. Keyboard shortcuts — depends on callbacks
  useKeyboardShortcuts({
    chooseFile,
    zoomAtCenter,
    setTransform,
    toggleCollapsed,
  });

  // ─────────── Derived values ───────────
  const renderedHtml = useMemo(
    () => ({
      __html:
        document && document.kind !== "parquet" && document.kind !== "code-graph"
          ? document.kind === "mermaid"
            ? renderMermaid(document.content)
            : renderMarkdown(document.content)
          : "",
    }),
    [document, theme],
  );
  const isMarkdown = document?.kind === "markdown";
  const isMermaid = document?.kind === "mermaid";
  const isCodeGraph = document?.kind === "code-graph";

  // ─────────── Render ───────────
  return (
    <main
      className={collapsed ? "app collapsed" : "app"}
      style={
        collapsed
          ? undefined
          : { gridTemplateColumns: `${panelWidth}px 4px minmax(0, 1fr)` }
      }
    >
      <FileList
        files={files}
        history={history}
        document={document}
        directory={directory}
        collapsed={collapsed}
        panelWidth={panelWidth}
        onLoadFile={loadFile}
        onPanelWidthChange={handlePanelWidthChange}
      />
      <section className="viewer">
        <Toolbar
          document={document}
          collapsed={collapsed}
          theme={theme}
          transform={transform}
          isMermaid={!!isMermaid}
          commentsOpen={commentsOpen}
          commentsCount={comments.length}
          onTogglePanel={toggleCollapsed}
          onChooseFile={chooseFile}
          onThemeToggle={toggleTheme}
          onZoomIn={() => zoomAtCenter(1.25)}
          onZoomOut={() => zoomAtCenter(0.8)}
          onZoomReset={() => setTransform(resetTransform())}
          onToggleComments={() => setCommentsOpen((c) => !c)}
          onOpenWorkspace={openWorkspace}
        />
        {commentsOpen && isMermaid && document && (
          <CommentsPanel
            document={document as FileDocument}
            comments={comments}
            commentTag={commentTag}
            copied={copied}
            onCommentTagChange={setCommentTag}
            onRemoveComment={removeComment}
            onCopyComments={copyComments}
            onClose={() => setCommentsOpen(false)}
          />
        )}
        {error && <div className="error-banner">{error}</div>}
        <ContentArea
          isScanning={isScanning}
          onCancelScan={cancelWorkspaceScan}
          document={document}
          renderedHtml={renderedHtml}
          isMarkdown={!!isMarkdown}
          isMermaid={!!isMermaid}
          transform={transform}
          isPanning={isPanning}
          editor={editor}
          onError={setError}
          onSaveEditor={saveEditorComment}
          onCancelEditor={() => setEditor(null)}
          onBeginPan={isMermaid ? beginPan : undefined}
          onMovePan={isMermaid ? movePan : undefined}
          onEndPan={isMermaid ? endPan : undefined}
          viewportRef={viewportRef}
          previewRef={previewRef}
          editorTextRef={editorTextRef}
        />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);