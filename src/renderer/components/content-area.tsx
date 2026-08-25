import React, { type PointerEvent as ReactPointerEvent } from "react";
import type { FileDocument, ParquetDocument, CodeGraphDocument } from "../../shared/types";
import { ParquetTable } from "../parquet-table";
import { CodeGraphPage, ScanningOverlay } from "./code-graph-page";
import type { ViewTransform } from "../zoom-pan";
import type { EditorState } from "../hooks/use-comments";

interface ContentAreaProps {
  isScanning: boolean;
  onCancelScan: () => void;
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  renderedHtml: { __html: string };
  isMarkdown: boolean;
  isMermaid: boolean;
  transform: ViewTransform;
  isPanning: boolean;
  editor: EditorState | null;
  onError: (message: string) => void;
  onSaveEditor: () => void;
  onCancelEditor: () => void;
  onBeginPan?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMovePan?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEndPan?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  previewRef: React.RefObject<HTMLElement | null>;
  /** Ref for the inline comment textarea — owned by useComments, passed through. */
  editorTextRef: React.RefObject<HTMLTextAreaElement | null>;
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
  editor,
  onError,
  onSaveEditor,
  onCancelEditor,
  onBeginPan,
  onMovePan,
  onEndPan,
  viewportRef,
  previewRef,
  editorTextRef,
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

  if (!document) {
    return (
      <div className="empty">
        Open a Markdown, Mermaid, or Parquet file (File ▸ Open… or
        Ctrl+O).
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`${isMarkdown ? "markdown-viewport" : "canvas-viewport"} ${isPanning ? "is-panning" : ""}`}
      onPointerDown={isMermaid ? onBeginPan : undefined}
      onPointerMove={isMermaid ? onMovePan : undefined}
      onPointerUp={isMermaid ? onEndPan : undefined}
      onPointerCancel={isMermaid ? onEndPan : undefined}
    >
      <article
        ref={previewRef}
        className={`document ${isMarkdown ? "markdown-preview" : "diagram-preview"}`}
        style={
          isMermaid
            ? {
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }
            : undefined
        }
        dangerouslySetInnerHTML={renderedHtml}
      />
      {editor && (
        <CommentEditor
          editor={editor}
          editorTextRef={editorTextRef}
          onSave={onSaveEditor}
          onCancel={onCancelEditor}
        />
      )}
    </div>
  );
}

function CommentEditor({
  editor,
  editorTextRef,
  onSave,
  onCancel,
}: {
  editor: EditorState;
  editorTextRef: React.RefObject<HTMLTextAreaElement | null>;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div
      className="comment-editor"
      style={{ left: editor.x, top: editor.y }}
    >
      <div className="comment-editor-title">
        {editor.id} · line {editor.line}
      </div>
      <textarea
        ref={editorTextRef}
        defaultValue={editor.initial}
        rows={2}
        autoFocus
        placeholder={`Comment on ${editor.id}…`}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSave();
          }
          if (event.key === "Escape") onCancel();
        }}
      />
      <div className="comment-editor-actions">
        <button onClick={onSave}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}