import DOMPurify from "dompurify";
import { marked } from "marked";

export function normalizeMermaidSource(source: string): string {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:mermaid)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

export function renderMarkdown(source: string): string {
  const withMermaidPlaceholders = source.replace(
    /```mermaid\s*\n([\s\S]*?)```/gi,
    (_match, diagram: string) => {
      return `<div class="mermaid" data-diagram="${encodeURIComponent(diagram.trim())}"></div>`;
    },
  );
  return DOMPurify.sanitize(marked.parse(withMermaidPlaceholders) as string, {
    ADD_TAGS: ["div"],
    ADD_ATTR: ["data-diagram", "class"],
  });
}

export function renderMermaid(source: string): string {
  return `<div class="mermaid" data-diagram="${encodeURIComponent(normalizeMermaidSource(source))}"></div>`;
}
