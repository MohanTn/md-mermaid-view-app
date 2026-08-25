import { useCallback, useEffect } from "react";
import type { MermaidConfig } from "mermaid";
import type { FileDocument, ParquetDocument, CodeGraphDocument } from "../../shared/types";
import {
  extractSubgraphs,
  findNodeLine,
  nodeIdFromDomId,
  type DiagramComment,
} from "../diagram-comments";
import { normalizeMermaidSource } from "../markdown";
import type { Theme } from "./use-theme";

function mermaidConfig(theme: Theme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    flowchart: {
      padding: 8,
      nodeSpacing: 160,
      rankSpacing: 150,
      useMaxWidth: true,
      htmlLabels: true,
    },
  };
}

interface UseMermaidRenderParams {
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  theme: Theme;
  previewRef: React.RefObject<HTMLElement | null>;
  /** Live ref to current comments (used inside the highlight re-apply effect). */
  commentsRef: React.MutableRefObject<DiagramComment[]>;
  /** Shared with pan/zoom — suppressing node clicks after a drag. */
  panMovedRef: React.MutableRefObject<boolean>;
  /** Callback to open the inline comment editor for a clicked node. */
  openCommentEditor: (id: string, line: number, element: SVGGElement) => void;
  setError: (msg: string) => void;
}

/** Renders Mermaid diagrams into `.mermaid` placeholders and wires node
 *  click → comment editor.  Re-applies highlight CSS classes when comments
 *  change (so no full re-render is needed). */
export function useMermaidRender({
  document,
  theme,
  previewRef,
  commentsRef,
  panMovedRef,
  openCommentEditor,
  setError,
}: UseMermaidRenderParams): void {
  // ──────────────────────────────────────────────────────────────
  // Main render effect — fires when the document or theme changes
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!previewRef.current || document?.kind === "parquet") return;
      await window.document.fonts.ready;
      const { default: mermaid } = await import("mermaid");
      if (cancelled || !previewRef.current) return;
      mermaid.initialize(mermaidConfig(theme));

      const nodes = Array.from(
        previewRef.current.querySelectorAll<HTMLElement>(".mermaid"),
      );

      await Promise.all(
        nodes.map(async (node) => {
          if (cancelled) return;
          try {
            const source = normalizeMermaidSource(
              decodeURIComponent(node.dataset.diagram ?? ""),
            );
            node.classList.add("mermaid-rendering");
            node.textContent = source;
            await mermaid.run({ nodes: [node] });
            if (cancelled) return;
            node.classList.remove("mermaid-rendering");
            if (!node.querySelector("svg"))
              throw new Error("Mermaid returned no SVG output.");
            attachNodeClickHandlers(node, source);
            applyCommentHighlights(node, source, commentsRef.current);
          } catch (renderError) {
            if (cancelled) return;
            node.className = "mermaid mermaid-error";
            const wrapped = renderError as
              | { str?: string; message?: string }
              | undefined;
            const message =
              renderError instanceof Error
                ? renderError.message
                : (wrapped?.str ??
                  wrapped?.message ??
                  "Unable to render diagram.");
            node.replaceChildren(window.document.createTextNode(message));
          }
        }),
      );
    };

    void run().catch((renderError: unknown) => {
      if (!cancelled)
        setError(
          renderError instanceof Error
            ? renderError.message
            : String(renderError),
        );
    });

    return () => {
      cancelled = true;
    };
  }, [document, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // ──────────────────────────────────────────────────────────────
  // Re-apply highlights when comments change (no full re-render)
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>(".mermaid").forEach((el) => {
      applyCommentHighlights(
        el,
        normalizeMermaidSource(decodeURIComponent(el.dataset.diagram ?? "")),
        commentsRef.current,
      );
    });
  }, [commentsRef.current, document]); // eslint-disable-line react-hooks/exhaustive-deps

  // ──────────────────────────────────────────────────────────────
  // Pure helpers (not stateful, defined outside JSX scope)
  // ──────────────────────────────────────────────────────────────
  function attachNodeClickHandlers(
    container: HTMLElement,
    source: string,
  ): void {
    const subgraphs = extractSubgraphs(source);
    const subgraphByTitle = new Map(subgraphs.map((s) => [s.title, s]));
    container
      .querySelectorAll<SVGGElement>("g.node, g.cluster")
      .forEach((g) => {
        g.addEventListener("click", (event) => {
          event.stopPropagation();
          if (panMovedRef.current) return;
          let id: string | null = null;
          if (g.classList.contains("cluster")) {
            const label = (
              g.querySelector(".cluster-label, foreignObject, text")
                ?.textContent ?? ""
            ).trim();
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

  function applyCommentHighlights(
    container: HTMLElement,
    source: string,
    cs: DiagramComment[],
  ): void {
    const subgraphs = extractSubgraphs(source);
    const subgraphByTitle = new Map(subgraphs.map((s) => [s.title, s.id]));
    container
      .querySelectorAll<SVGGElement>("g.node, g.cluster")
      .forEach((g) => {
        let id: string | null = null;
        if (g.classList.contains("cluster")) {
          const label = (
            g.querySelector(".cluster-label, foreignObject, text")
              ?.textContent ?? ""
          ).trim();
          id = subgraphByTitle.get(label) ?? null;
        } else {
          id = nodeIdFromDomId(g.id);
        }
        g.classList.toggle(
          "has-comment",
          id !== null && cs.some((c) => c.id === id),
        );
      });
  }
}
