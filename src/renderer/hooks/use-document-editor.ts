import { useCallback, useEffect, useState } from "react";
import type { FileDocument, ParquetDocument, CodeGraphDocument } from "../../shared/types";

const EDITOR_HEIGHT_KEY = "md-mermaid-viewer-editor-height";
const MIN_EDITOR_HEIGHT = 100;
const MAX_EDITOR_HEIGHT = 600;

export type EditorViewMode = "markdown" | "mermaid";

export interface UseDocumentEditorResult {
  editorSource: string;
  setEditorSource: (source: string) => void;
  viewMode: EditorViewMode;
  setViewMode: (mode: EditorViewMode) => void;
  editorHeight: number;
  handleEditorHeightChange: (height: number) => void;
}

/**
 * Owns the live-editable source shown in the lower-half editor pane, which
 * mode (Markdown or Mermaid) that source is currently previewed as, and the
 * persisted height of the pane. The buffer and mode reset to the file's
 * on-disk kind/content whenever a new document is opened; edits and mode
 * switches after that live only in memory (mermaid.live-style), never saved
 * to disk.
 */
export function useDocumentEditor(
  document: FileDocument | ParquetDocument | CodeGraphDocument | null,
): UseDocumentEditorResult {
  const [editorSource, setEditorSource] = useState("");
  const [viewMode, setViewMode] = useState<EditorViewMode>("markdown");
  const [editorHeight, setEditorHeight] = useState(() => {
    const saved = Number(localStorage.getItem(EDITOR_HEIGHT_KEY));
    return saved >= MIN_EDITOR_HEIGHT && saved <= MAX_EDITOR_HEIGHT
      ? saved
      : 220;
  });

  useEffect(() => {
    if (!document || document.kind === "parquet" || document.kind === "code-graph")
      return;
    setEditorSource(document.content);
    setViewMode(document.kind);
  }, [document]);

  const handleEditorHeightChange = useCallback((height: number) => {
    const clamped = Math.max(
      MIN_EDITOR_HEIGHT,
      Math.min(MAX_EDITOR_HEIGHT, height),
    );
    setEditorHeight(clamped);
    localStorage.setItem(EDITOR_HEIGHT_KEY, String(clamped));
  }, []);

  return {
    editorSource,
    setEditorSource,
    viewMode,
    setViewMode,
    editorHeight,
    handleEditorHeightChange,
  };
}
