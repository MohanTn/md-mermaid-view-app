/** Text-based documents rendered as HTML. */
export type TextDocumentKind = 'markdown' | 'mermaid';
export type DocumentKind = TextDocumentKind | 'parquet';

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

/** A Parquet file opened for viewing: schema plus the first page of rows. */
export interface ParquetDocument {
  path: string;
  name: string;
  kind: 'parquet';
  updatedAt: number;
  fileSize: number;
  columns: ParquetColumn[];
  totalRows: number;
  pageSize: number;
  rows: Record<string, unknown>[];
}

/** One page of rows read from a Parquet file. */
export interface ParquetPage {
  rows: Record<string, unknown>[];
}

export interface ParquetQuery {
  /** 1-based page number. */
  page: number;
  /** Case-insensitive substring filter across all columns; null/empty for none. */
  filter?: string | null;
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
}

export interface ParquetQueryResult {
  rows: Record<string, unknown>[];
  /** Number of rows matching the current filter/sort scope. */
  totalMatching: number;
  page: number;
  pageSize: number;
  /** True when only the first portion of a large file was scanned. */
  truncated: boolean;
}

export interface ViewerApi {
  chooseFile: () => Promise<FileDocument | null>;
  openPath: (filePath: string) => Promise<FileDocument>;
  listDirectory: (directoryPath?: string) => Promise<FileEntry[]>;
  onOpenPath: (callback: (filePath: string) => void) => () => void;
  readSidecar: (filePath: string, tag: string) => Promise<string>;
  writeSidecar: (filePath: string, tag: string, content: string) => Promise<string>;
  copyText: (text: string) => Promise<void>;
  openParquet: (filePath: string) => Promise<ParquetDocument>;
  openParquetPage: (filePath: string, rowStart: number, rowEnd: number) => Promise<ParquetPage>;
  queryParquet: (filePath: string, query: ParquetQuery) => Promise<ParquetQueryResult>;
}
