import React, { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import type { GraphNode, NodeDetail } from "../../shared/types";

interface ReferencePanelProps {
  node: GraphNode;
  onClose: () => void;
}

export function ReferencePanel({
  node,
  onClose,
}: ReferencePanelProps): React.JSX.Element {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewedFile, setViewedFile] = useState<string>(node.filePath);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setViewedFile(node.filePath);

    window.viewer
      .getNodeDetail(node.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        // Fallback: just show the node without LSP detail
        if (!cancelled)
          setDetail({
            node,
            sourceContent: `// Source file: ${node.filePath}`,
            references: [],
            referencedFiles: [],
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [node]);

  const language = mapLanguage(node.language);
  // node.label is the file name plus its whole member list (see buildGraph)
  // for the graph box — the panel title only wants the file name itself.
  const title = node.label.split("\n")[0];

  return (
    <aside className="reference-panel">
      <header className="reference-panel-header">
        <h3>
          <span className={`reference-node-icon type-${node.type}`}>
            {iconForType(node.type)}
          </span>
          {title}
        </h3>
        <button
          className="reference-panel-close"
          onClick={onClose}
          aria-label="Close reference panel"
        >
          ✕
        </button>
      </header>

      {loading ? (
        <div className="reference-panel-loading">Loading…</div>
      ) : (
        <>
          {/* File path with clickable referenced files */}
          <div className="reference-file-path">
            <span className="ref-label">Defined in:</span>
            <span className="ref-path">{node.filePath}</span>
            {node.detail && (
              <span className="ref-detail">{node.detail}</span>
            )}
          </div>

          {/* Tab bar: source | referenced files */}
          <div className="reference-tabs">
            <button
              className={`reference-tab ${viewedFile === node.filePath ? "active" : ""}`}
              onClick={() => setViewedFile(node.filePath)}
            >
              Source
            </button>
            {detail?.referencedFiles.map((file) => (
              <button
                key={file}
                className={`reference-tab ${viewedFile === file ? "active" : ""}`}
                onClick={() => setViewedFile(file)}
                title={file}
              >
                {file.split(/[/\\]/).pop() ?? file}
              </button>
            ))}
          </div>

          {/* Monaco editor (read-only) */}
          <div className="reference-monaco">
            <Editor
              height="100%"
              language={language}
              value={
                viewedFile === node.filePath
                  ? detail?.sourceContent ?? ""
                  : `// Referenced by ${node.label}\n// File: ${viewedFile}`
              }
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                fontSize: 12,
                wordWrap: "on",
                automaticLayout: true,
              }}
            />
          </div>

          {/* Reference count summary */}
          {detail && detail.references.length > 0 && (
            <div className="reference-count">
              {detail.references.length} reference
              {detail.references.length > 1 ? "s" : ""} found
            </div>
          )}
        </>
      )}
    </aside>
  );
}

// ─────────── Helpers ───────────

function mapLanguage(lang?: string): string {
  switch (lang) {
    case "typescript":
    case "typescriptreact":
      return "typescript";
    case "javascript":
    case "javascriptreact":
      return "javascript";
    case "python":
      return "python";
    case "go":
      return "go";
    case "csharp":
      return "csharp";
    default:
      return "plaintext";
  }
}

function iconForType(type: string): string {
  switch (type) {
    case "file":
      return "📄";
    case "class":
      return "⬡";
    case "interface":
      return "◇";
    case "function":
      return "ƒ";
    case "method":
      return "Ⓜ";
    case "variable":
      return "▦";
    case "module":
      return "📦";
    default:
      return "○";
  }
}