import React, { type PointerEvent as ReactPointerEvent } from "react";
import Editor from "@monaco-editor/react";
import type { FileDocument, ParquetDocument, CodeGraphDocument } from "../../shared/types";
import { ParquetTable } from "../parquet-table";
import { CodeGraphPage, ScanningOverlay } from "./code-graph-page";
import type { ViewTransform } from "../zoom-pan";
import type { Theme } from "../hooks/use-theme";
import type { EditorViewMode } from "../hooks/use-document-editor";

const MIN_EDITOR_HEIGHT = 100;
const MAX_EDITOR_HEIGHT = 600;

interface ContentAreaProps {
  isScanning: boolean;
  onCancelScan: () => void;
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  renderedHtml: { __html: string };
  isMarkdown: boolean;
  isMermaid: boolean;
  transform: ViewTransform;
  isPanning: boolean;
  theme: Theme;
  editorSource: string;
  onEditorSourceChange: (source: string) => void;
  viewMode: EditorViewMode;
  onViewModeChange: (mode: EditorViewMode) => void;
  editorHeight: number;
  onEditorHeightChange: (height: number) => void;
  onError: (message: string) => void;
  onBeginPan?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMovePan?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEndPan?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  previewRef: React.RefObject<HTMLElement | null>;
}

export function ContentArea({
  isScanning,
  onCancelScan,
  document,
  renderedHtml,
  isMarkdown,
  isMermaid,
  transform,
  isPanning,
  theme,
  editorSource,
  onEditorSourceChange,
  viewMode,
  onViewModeChange,
  editorHeight,
  onEditorHeightChange,
  onError,
  onBeginPan,
  onMovePan,
  onEndPan,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  viewportRef,
  previewRef,
}: ContentAreaProps): React.JSX.Element {
  if (document?.kind === "parquet") {
    return (
      <ParquetTable
        key={document.path}
        document={document}
        onError={onError}
      />
    );
  }

  if (isScanning) {
    return <ScanningOverlay onCancel={onCancelScan} />;
  }

  if (document?.kind === "code-graph") {
    return (
      <CodeGraphPage
        key={document.path}
        document={document}
        onError={onError}
      />
    );
  }

  // No file open yet and nothing typed: still a live scratchpad (the parent
  // keeps isMarkdown/isMermaid meaningful even with document === null), just
  // with a hint where the preview will appear instead of rendered content.
  const isEmptySource = !editorSource.trim();

  const canvasPane = (
    <div
      ref={viewportRef}
      className={`${isMarkdown ? "markdown-viewport" : "canvas-viewport"} ${isPanning ? "is-panning" : ""}`}
      onPointerDown={isMermaid ? onBeginPan : undefined}
      onPointerMove={isMermaid ? onMovePan : undefined}
      onPointerUp={isMermaid ? onEndPan : undefined}
      onPointerCancel={isMermaid ? onEndPan : undefined}
    >
      {isEmptySource ? (
        <div className="empty">
          Type {isMermaid ? "Mermaid" : "Markdown"} in the editor below to
          preview it here.
        </div>
      ) : (
        <article
          ref={previewRef}
          className={`document ${isMarkdown ? "markdown-preview" : "diagram-preview"}`}
        >
          {isMermaid ? (
            <div className="diagram-content">
              <div
                className="diagram-transform"
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                }}
                dangerouslySetInnerHTML={renderedHtml}
              />
            </div>
          ) : (
            <div dangerouslySetInnerHTML={renderedHtml} />
          )}
        </article>
      )}
      {isMermaid && !isEmptySource && (
        <div className="mermaid-canvas-controls" role="group" aria-label="Diagram controls">
          <button onClick={onZoomOut} title="Zoom out (Ctrl+-)" aria-label="Zoom out">
            −
          </button>
          <span aria-live="polite">{Math.round(transform.scale * 100)}%</span>
          <button onClick={onZoomIn} title="Zoom in (Ctrl++)" aria-label="Zoom in">
            +
          </button>
          <button onClick={onZoomReset} title="Reset view (Ctrl+0)" aria-label="Reset diagram view">
            ⌂
          </button>
        </div>
      )}
    </div>
  );

  // Mermaid.live-style workspace: preview on top, a live source editor
  // docked across the lower half by default, resizable via the handle
  // between, with a toggle to preview the buffer as Markdown or Mermaid.
  return (
    <div className="doc-workspace">
      <div className="doc-workspace-canvas">{canvasPane}</div>
      <EditorResizeHandle
        editorHeight={editorHeight}
        onEditorHeightChange={onEditorHeightChange}
      />
      <div className="doc-editor-pane" style={{ height: editorHeight }}>
        <div className="reference-tabs" role="group" aria-label="Preview as">
          <button
            className={`reference-tab ${viewMode === "markdown" ? "active" : ""}`}
            onClick={() => onViewModeChange("markdown")}
          >
            Markdown
          </button>
          <button
            className={`reference-tab ${viewMode === "mermaid" ? "active" : ""}`}
            onClick={() => onViewModeChange("mermaid")}
          >
            Mermaid
          </button>
        </div>
        <div className="doc-editor-monaco">
          <Editor
            height="100%"
            language="markdown"
            value={editorSource}
            onChange={(value) => onEditorSourceChange(value ?? "")}
            theme={theme === "dark" ? "vs-dark" : "vs"}
            options={{
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function EditorResizeHandle({
  editorHeight,
  onEditorHeightChange,
}: {
  editorHeight: number;
  onEditorHeightChange: (height: number) => void;
}): React.JSX.Element {
  const draggingRef = React.useRef(false);
  const dragStartY = React.useRef(0);
  const dragStartHeight = React.useRef(editorHeight);

  React.useEffect(() => {
    dragStartHeight.current = editorHeight;
  }, [editorHeight]);

  function onDown(event: ReactPointerEvent): void {
    event.preventDefault();
    draggingRef.current = true;
    dragStartY.current = event.clientY;
    dragStartHeight.current = editorHeight;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onMove(event: ReactPointerEvent): void {
    if (!draggingRef.current) return;
    // The editor sits below the handle, so dragging up (negative delta)
    // should grow it and dragging down should shrink it.
    const next = Math.max(
      MIN_EDITOR_HEIGHT,
      Math.min(
        MAX_EDITOR_HEIGHT,
        dragStartHeight.current + (dragStartY.current - event.clientY),
      ),
    );
    onEditorHeightChange(next);
  }

  function onUp(event: ReactPointerEvent): void {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }

  return (
    <div
      className="doc-editor-resize-handle"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}