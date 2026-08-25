import React, { useEffect, useRef, useState } from "react";
import type { CodeGraphDocument } from "../../shared/types";
import { CodeGraphView } from "./code-graph-view";

// ─────────── CodeGraphPage (document already loaded) ───────────

interface CodeGraphPageProps {
  document: CodeGraphDocument;
  onError: (message: string) => void;
}

export function CodeGraphPage({
  document,
  onError,
}: CodeGraphPageProps): React.JSX.Element {
  const graph = document.graph;

  if (graph.nodes.length === 0) {
    return (
      <div className="code-graph-scanning">
        <span className="graph-empty-icon">📭</span>
        <h3 className="scan-phase-label">No symbols found</h3>
        <p className="graph-empty-hint">
          The workspace <code>{document.workspaceInfo.root}</code> contains{" "}
          {document.workspaceInfo.fileCount} source file
          {document.workspaceInfo.fileCount !== 1 ? "s" : ""} but no classes,
          functions, or variables could be extracted.
        </p>
        {document.workspaceInfo.languages.length > 0 && (
          <p className="graph-empty-hint">
            Languages detected:{" "}
            {document.workspaceInfo.languages.map((lang) => (
              <span key={lang} className="scan-lang-badge">{lang}</span>
            ))}
          </p>
        )}
        <button
          className="scan-retry"
          onClick={() =>
            onError(
              "The language server could not parse this workspace. " +
              "Make sure typescript-language-server and typescript are installed:\n" +
              "  npm install typescript-language-server typescript pyright",
            )
          }
        >
          Show details
        </button>
      </div>
    );
  }

  return (
    <CodeGraphView
      graph={graph}
      workspaceRoot={document.workspaceInfo.root}
      savedLayout={document.savedLayout}
      onError={onError}
    />
  );
}

// ─────────── ScanningOverlay (shows while main process dialog + scan is running) ───────────

const SLOW_SCAN_MS = 8_000;

interface ScanningOverlayProps {
  onCancel: () => void;
}

export function ScanningOverlay({ onCancel }: ScanningOverlayProps): React.JSX.Element {
  const [message, setMessage] = useState("Opening workspace…");
  const [cancelling, setCancelling] = useState(false);
  const startedAt = useRef(Date.now());
  const [, setTick] = useState(0);

  // Subscribe to scan progress from main process.
  useEffect(() => {
    const unsub = window.viewer.onScanProgress((msg) => {
      setMessage(msg);
    });
    return unsub;
  }, []);

  // Tick every 250ms for the elapsed counter.
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
  const showSlowHint = elapsed * 1000 >= SLOW_SCAN_MS;

  return (
    <div className="code-graph-scanning">
      <div className="scan-icon">
        <div className="scan-icon-ring" />
        <span className="scan-icon-inner">🔍</span>
      </div>

      <h3 className="scan-phase-label">{message}</h3>

      {/* Indeterminate progress bar — pulses to show activity. */}
      <div className="scan-bar-track">
        <div className="scan-bar-fill scan-bar-indeterminate" />
      </div>

      <div className="scan-details">
        <span className="scan-detail-elapsed">
          {elapsed < 60
            ? `${elapsed}s elapsed`
            : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`}
        </span>
      </div>

      {showSlowHint && (
        <p className="scan-slow-hint">
          Still working — the language server is indexing every symbol.
          Large projects may take a minute.
        </p>
      )}

      <button
        className="scan-cancel"
        disabled={cancelling}
        onClick={() => {
          setCancelling(true);
          onCancel();
        }}
      >
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </div>
  );
}