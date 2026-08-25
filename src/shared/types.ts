// ─────────── Language identifiers ───────────

/** Languages supported by the code graph viewer (LSP server must be available). */
export type CodeLanguage =
  | "typescript"
  | "javascript"
  | "typescriptreact"
  | "javascriptreact"
  | "python"
  | "go"
  | "csharp";

/** Map file extensions to CodeLanguage for LSP routing. */
export const EXTENSION_LANGUAGE_MAP: Record<string, CodeLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".cs": "csharp",
};

// ─────────── Document kinds ───────────

export type TextDocumentKind = "markdown" | "mermaid";
export type DocumentKind = TextDocumentKind | "parquet" | "code-graph";

export interface FileDocument {
  path: string;
  name: string;
  kind: TextDocumentKind;
  content: string;
  updatedAt: number;
}

export interface FileEntry {
  path: string;
  name: string;
  kind: DocumentKind;
}

export interface ParquetColumn {
  name: string;
  type: string;
}

export interface ParquetDocument {
  path: string;
  name: string;
  kind: "parquet";
  updatedAt: number;
  fileSize: number;
  columns: ParquetColumn[];
  totalRows: number;
  pageSize: number;
  rows: Record<string, unknown>[];
}

export interface ParquetPage {
  rows: Record<string, unknown>[];
}

export interface ParquetQuery {
  page: number;
  filter?: string | null;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc" | null;
}

export interface ParquetQueryResult {
  rows: Record<string, unknown>[];
  totalMatching: number;
  page: number;
  pageSize: number;
  scannedRows: number;
  truncated: boolean;
}

// ─────────── Code graph types ───────────

/** A position in a source file (0-indexed lines and characters per LSP). */
export interface CodePosition {
  line: number;
  character: number;
}

/** A range in a source file. */
export interface CodeRange {
  start: CodePosition;
  end: CodePosition;
}

/** A code symbol extracted via LSP documentSymbol. */
export interface CodeSymbol {
  /** Unique: `${filePath}#${symbolName}` */
  id: string;
  name: string;
  kind:
    | "function"
    | "method"
    | "class"
    | "variable"
    | "interface"
    | "type"
    | "module";
  filePath: string;
  language: CodeLanguage;
  range: CodeRange;
  /** Signature / type annotation when available. */
  detail?: string;
  /** Id of the enclosing symbol (e.g. a class containing a method), if nested. Top-level symbols are contained by the file instead. */
  parentId?: string;
}

/** A reference from one symbol to another (LSP textDocument/references result). */
export interface SymbolReference {
  sourceSymbolId: string;
  targetSymbolId: string;
  /** The name as written at the reference site. */
  targetName: string;
  filePath: string;
  range: CodeRange;
}

/** A node in the Cytoscape graph. */
export interface GraphNode {
  id: string;
  label: string;
  type:
    | "file"
    | "class"
    | "function"
    | "method"
    | "variable"
    | "interface"
    | "type"
    | "module";
  filePath: string;
  language?: CodeLanguage;
  /** E.g. method signature or type annotation. */
  detail?: string;
}

/** An edge connecting two graph nodes. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "contains" | "references" | "implements" | "calls" | "imports";
}

/** The full code graph for a workspace. */
export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  workspaceRoot: string;
  languages: CodeLanguage[];
}

/** Summary returned after scanning a workspace. */
export interface WorkspaceInfo {
  root: string;
  name: string;
  languages: CodeLanguage[];
  fileCount: number;
  symbolCount: number;
}

/** Detail for a selected node: source content + all references. */
export interface NodeDetail {
  node: GraphNode;
  sourceContent: string;
  references: SymbolReference[];
  /** File paths where this symbol is referenced (deduped). */
  referencedFiles: string[];
}

/** A manually-arranged (or previously saved) graph layout, keyed by node id. */
export interface SavedGraphLayout {
  positions: Record<string, { x: number; y: number }>;
  savedAt: string;
}

export interface CodeGraphDocument {
  path: string;
  name: string;
  kind: "code-graph";
  graph: CodeGraph;
  workspaceInfo: WorkspaceInfo;
  /** Present when a layout was previously saved for this workspace (see saveGraphLayout). */
  savedLayout: SavedGraphLayout | null;
}

/** Error message thrown/rejected when a workspace scan is cancelled by the user. */
export const SCAN_CANCELLED_MESSAGE = "Workspace scan cancelled.";

// ─────────── API surface (exposed via preload) ───────────

export interface ViewerApi {
  chooseFile: () => Promise<FileDocument | null>;
  openPath: (filePath: string) => Promise<FileDocument>;
  listDirectory: (directoryPath?: string) => Promise<FileEntry[]>;
  onOpenPath: (callback: (filePath: string) => void) => () => void;
  readSidecar: (filePath: string, tag: string) => Promise<string>;
  writeSidecar: (
    filePath: string,
    tag: string,
    content: string,
  ) => Promise<string>;
  copyText: (text: string) => Promise<void>;
  openParquet: (filePath: string) => Promise<ParquetDocument>;
  openParquetPage: (
    filePath: string,
    rowStart: number,
    rowEnd: number,
  ) => Promise<ParquetPage>;
  queryParquet: (
    filePath: string,
    query: ParquetQuery,
  ) => Promise<ParquetQueryResult>;

  // ── Code graph ──

  /** Pick a workspace directory and scan it. Returns the full code graph document. */
  openWorkspace: () => Promise<CodeGraphDocument | null>;
  /** Scan a directory and return the graph. */
  scanWorkspace: (directoryPath: string) => Promise<CodeGraphDocument>;
  /** Cancel the in-progress workspace scan, if any. */
  cancelScan: () => Promise<void>;
  /** Get detailed info for a selected node. */
  getNodeDetail: (nodeId: string) => Promise<NodeDetail>;
  /** Subscribe to scan progress messages. */
  onScanProgress: (callback: (message: string) => void) => () => void;
  /** Save the current node arrangement into the scanned workspace so future scans reuse it. */
  saveGraphLayout: (
    workspaceRoot: string,
    positions: Record<string, { x: number; y: number }>,
  ) => Promise<void>;
}