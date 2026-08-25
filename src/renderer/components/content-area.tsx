import React, { type PointerEvent as ReactPointerEvent } from "react";
import type { FileDocument, ParquetDocument, CodeGraphDocument } from "../../shared/types";
import { ParquetTable } from "../parquet-table";
import { CodeGraphPage, ScanningOverlay } from "./code-graph-page";
import type { ViewTransform } from "../zoom-pan";

interface ContentAreaProps {
  isScanning: boolean;
  onCancelScan: () => void;
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  renderedHtml: { __html: string };
  isMarkdown: boolean;
  isMermaid: boolean;
  transform: ViewTransform;
  isPanning: boolean;
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
      {isMermaid && (
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
}