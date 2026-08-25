import { useCallback, useEffect, useRef, useState } from "react";
import type { FileDocument, ParquetDocument, CodeGraphDocument } from "../../shared/types";
import {
  formatCommentsForClipboard,
  parseSidecar,
  serializeSidecar,
  type DiagramComment,
} from "../diagram-comments";

interface UseCommentsParams {
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  documentRef: React.RefObject<FileDocument | ParquetDocument | CodeGraphDocument | null>;
  setError: (message: string) => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

export interface EditorState {
  id: string;
  line: number;
  x: number;
  y: number;
  initial: string;
}

export interface UseCommentsResult {
  comments: DiagramComment[];
  commentTag: string;
  setCommentTag: React.Dispatch<React.SetStateAction<string>>;
  commentsOpen: boolean;
  setCommentsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  copied: boolean;
  editor: EditorState | null;
  setEditor: React.Dispatch<React.SetStateAction<EditorState | null>>;
  addComment: (id: string, line: number, text: string) => void;
  removeComment: (id: string, line: number) => void;
  copyComments: () => void;
  openCommentEditor: (id: string, line: number, element: SVGGElement) => void;
  saveEditorComment: () => void;
  /** Exposed so useMermaidRender can read live comments in highlight effects. */
  commentsRef: React.MutableRefObject<DiagramComment[]>;
  /** Exposed so ContentArea can attach to the inline comment <textarea>. */
  editorTextRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}

export function useComments({
  document,
  documentRef,
  setError,
  viewportRef,
}: UseCommentsParams): UseCommentsResult {
  const [comments, setComments] = useState<DiagramComment[]>([]);
  const [commentTag, setCommentTag] = useState("review");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const commentsRef = useRef<DiagramComment[]>([]);
  commentsRef.current = comments;
  const editorTextRef = useRef<HTMLTextAreaElement>(null);
  // We need a stable ref for the tag in persistComments (the closure captures it).
  const tagRef = useRef(commentTag);
  tagRef.current = commentTag;

  // ──────────────────────────────────────────────────────────────
  // Load comments from sidecar whenever document or tag changes
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!document || document.kind !== "mermaid") {
      setComments([]);
      return () => {
        cancelled = true;
      };
    }
    void window.viewer
      .readSidecar(document.path, commentTag)
      .then((content) => {
        if (!cancelled) setComments(parseSidecar(content));
      });
    return () => {
      cancelled = true;
    };
  }, [document, commentTag]);

  // ──────────────────────────────────────────────────────────────
  // Persist helpers
  // ──────────────────────────────────────────────────────────────
  const persist = useCallback(
    (next: DiagramComment[]) => {
      setComments(next);
      const doc = documentRef.current;
      if (!doc) return;
      void window.viewer
        .writeSidecar(doc.path, tagRef.current, serializeSidecar(next))
        .catch((writeError: unknown) => {
          setError(
            writeError instanceof Error
              ? writeError.message
              : String(writeError),
          );
        });
    },
    [documentRef, setError],
  );

  const addComment = useCallback(
    (id: string, line: number, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const current = commentsRef.current;
      const existing = current.find((c) => c.id === id && c.line === line);
      const next = existing
        ? current.map((c) => (c === existing ? { ...c, text: trimmed } : c))
        : [...current, { id, line, text: trimmed }];
      persist(next);
    },
    [persist],
  );

  const removeComment = useCallback(
    (id: string, line: number) => {
      persist(
        commentsRef.current.filter((c) => !(c.id === id && c.line === line)),
      );
    },
    [persist],
  );

  const copyComments = useCallback(() => {
    const doc = documentRef.current;
    if (!doc || commentsRef.current.length === 0) return;
    void window.viewer
      .copyText(formatCommentsForClipboard(commentsRef.current, doc.name))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      });
  }, [documentRef]);

  // ──────────────────────────────────────────────────────────────
  // Inline comment editor
  // ──────────────────────────────────────────────────────────────
  const openCommentEditor = useCallback(
    (id: string, line: number, element: SVGGElement) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = element.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      setEditor({
        id,
        line,
        x: Math.max(
          4,
          Math.min(rect.left - viewportRect.left, viewportRect.width - 260),
        ),
        y: rect.bottom - viewportRect.top + 8,
        initial:
          commentsRef.current.find((c) => c.id === id && c.line === line)
            ?.text ?? "",
      });
    },
    [viewportRef],
  );

  const saveEditorComment = useCallback(() => {
    if (!editor) return;
    addComment(editor.id, editor.line, editorTextRef.current?.value ?? "");
    setEditor(null);
  }, [editor, addComment]);

  return {
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
  };
}
