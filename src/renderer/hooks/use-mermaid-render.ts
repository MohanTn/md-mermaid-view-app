import { useEffect } from "react";
import type { MermaidConfig } from "mermaid";
import type { FileDocument, ParquetDocument, CodeGraphDocument } from "../../shared/types";
import { normalizeMermaidSource } from "../markdown";
import type { Theme } from "./use-theme";

function mermaidConfig(theme: Theme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
  };
}

interface UseMermaidRenderParams {
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  theme: Theme;
  previewRef: React.RefObject<HTMLElement | null>;
  /** Called once the canvas diagram has an SVG sized in pixels. */
  onRendered?: () => void;
  setError: (msg: string) => void;
  /**
   * Live-edited source for the current document. Not read directly (the
   * effect re-reads the already-updated `data-diagram` DOM attribute) — only
   * included so edits made in the editor trigger a re-render.
   */
  editorSource?: string;
  /** True when the editor's Mermaid/Markdown toggle is set to Mermaid. */
  isMermaidView: boolean;
}

/**
 * Pins the rendered SVG to its viewBox size in pixels. Mermaid emits
 * `width="100%"` plus an inline `max-width`, which resolves to zero inside the
 * canvas's `max-content` wrappers, so the diagram would render but be invisible.
 */
function sizeSvgToViewBox(node: HTMLElement): void {
  const svg = node.querySelector("svg");
  const box = svg?.viewBox.baseVal;
  if (!svg || !box || box.width <= 0 || box.height <= 0) return;
  svg.style.width = `${box.width}px`;
  svg.style.height = `${box.height}px`;
  svg.style.maxWidth = "none";
}

/** Renders Mermaid diagrams into `.mermaid` placeholders for the canvas. */
export function useMermaidRender({
  document,
  theme,
  previewRef,
  onRendered,
  setError,
  editorSource,
  isMermaidView,
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
            // Only the standalone canvas needs a pixel-sized SVG; inside a
            // Markdown article the diagram should shrink to the column.
            if (isMermaidView) {
              sizeSvgToViewBox(node);
              onRendered?.();
            }
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
  }, [document, theme, editorSource, isMermaidView]); // eslint-disable-line react-hooks/exhaustive-deps

}
