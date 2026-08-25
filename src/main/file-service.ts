import { promises as fs } from "node:fs";
import path from "node:path";
import {
  asyncBufferFromFile,
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
  type SchemaElement,
  type SchemaTree,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { cellText } from "../shared/cell-text.js";
import type {
  DocumentKind,
  FileDocument,
  FileEntry,
  ParquetDocument,
  ParquetPage,
  ParquetQuery,
  ParquetQueryResult,
} from "../shared/types.js";

const SUPPORTED_EXTENSIONS: Record<string, DocumentKind> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mmd": "mermaid",
  ".mermaid": "mermaid",
  ".parquet": "parquet",
};

/** Rows shown per page in the Parquet viewer. */
export const PARQUET_PAGE_SIZE = 100;

/**
 * Rows materialized for sort/filter. Files larger than this only scan the
 * first portion (the UI shows a note); plain browsing stays fully lazy.
 */
export const PARQUET_QUERY_ROW_CAP = 200_000;

/** Materialized row cache: path -> { updatedAt, rows, truncated }. */
const materializedCache = new Map<
  string,
  { updatedAt: number; rows: Record<string, unknown>[]; truncated: boolean }
>();

/** Compare two cell values for sorting (nulls last, type-aware). */
export function compareCells(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "bigint" && typeof b === "bigint")
    return a < b ? -1 : a > b ? 1 : 0;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  if (typeof a === "string" && typeof b === "string")
    return a.localeCompare(b, undefined, { numeric: true });
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Every whitespace-separated term must match at least one column's text. */
export function matchesFilter(
  row: Record<string, unknown>,
  filter: string,
): boolean {
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const searchable = Object.values(row).map(cellText).join(" ").toLowerCase();
  return terms.every((term) => searchable.includes(term));
}

/** Load (cached) rows for sort/filter, capped to the first PARQUET_QUERY_ROW_CAP. */
async function materializedRows(
  filePath: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const stats = await fs.stat(filePath);
  const cached = materializedCache.get(filePath);
  if (cached && cached.updatedAt === stats.mtimeMs) {
    // Keep the cache bounded; drop the oldest file when it grows too large.
    const oldestKey = materializedCache.keys().next().value;
    if (
      materializedCache.size > 5 &&
      oldestKey !== undefined &&
      oldestKey !== filePath
    ) {
      materializedCache.delete(oldestKey);
    }
    return cached;
  }
  const file = await asyncBufferFromFile(filePath);
  const metadata = await parquetMetadataAsync(file);
  const totalRows = Number(metadata.num_rows);
  const rows = await readParquetRows(
    filePath,
    0,
    Math.min(totalRows, PARQUET_QUERY_ROW_CAP),
  );
  const entry = {
    updatedAt: stats.mtimeMs,
    rows,
    truncated: totalRows > PARQUET_QUERY_ROW_CAP,
  };
  if (materializedCache.size >= 5) {
    const oldestKey = materializedCache.keys().next().value;
    if (oldestKey !== undefined) materializedCache.delete(oldestKey);
  }
  materializedCache.set(filePath, entry);
  return entry;
}

/** True when a schema node is a 3-level LIST wrapper per the Parquet spec. */
function isListLike(schema: SchemaTree): boolean {
  if (!schema || schema.element.converted_type !== "LIST") return false;
  if (schema.children.length > 1) return false;
  const firstChild = schema.children[0];
  if (firstChild.children.length > 1) return false;
  if (firstChild.element.repetition_type !== "REPEATED") return false;
  return true;
}

/** True when a schema node is a 3-level MAP wrapper per the Parquet spec. */
function isMapLike(schema: SchemaTree): boolean {
  if (!schema || schema.element.converted_type !== "MAP") return false;
  if (schema.children.length > 1) return false;
  const firstChild = schema.children[0];
  if (firstChild.children.length !== 2) return false;
  if (firstChild.element.repetition_type !== "REPEATED") return false;
  const keyChild = firstChild.children.find(
    (child) => child.element.name === "key",
  );
  if (keyChild?.element.repetition_type === "REPEATED") return false;
  const valueChild = firstChild.children.find(
    (child) => child.element.name === "value",
  );
  if (valueChild?.element.repetition_type === "REPEATED") return false;
  return true;
}

/** Short human-readable name for a leaf column's type. */
function describeLeafType(element: SchemaElement): string {
  if (element.logical_type?.type)
    return element.logical_type.type.toLowerCase();
  if (element.converted_type) return element.converted_type.toLowerCase();
  return (element.type ?? "unknown").toLowerCase();
}

/** Recursively describe a column's type, e.g. `list<string>` or `struct<x: int32>`. */
function describeColumnType(node: SchemaTree): string {
  if (node.children.length === 0) return describeLeafType(node.element);
  if (isListLike(node)) {
    const wrapper = node.children[0];
    const inner = wrapper.children.length === 1 ? wrapper.children[0] : wrapper;
    return `list<${describeColumnType(inner)}>`;
  }
  if (isMapLike(node)) {
    const keyValue = node.children[0];
    const key = keyValue.children[0];
    const value = keyValue.children[1] ?? key;
    return `map<${describeColumnType(key)}, ${describeColumnType(value)}>`;
  }
  return `struct<${node.children.map((child) => `${child.element.name}: ${describeColumnType(child)}`).join(", ")}>`;
}

async function readParquetRows(
  filePath: string,
  rowStart: number,
  rowEnd: number,
): Promise<Record<string, unknown>[]> {
  if (rowStart >= rowEnd) return [];
  // `compressors` adds gzip, brotli, zstd, lz4 and lz4_raw support on top of
  // hyparquet's built-in snappy, so real-world files decode out of the box.
  const file = await asyncBufferFromFile(filePath);
  return parquetReadObjects({ file, rowStart, rowEnd, compressors });
}

export function getDocumentKind(filePath: string): DocumentKind | null {
  return SUPPORTED_EXTENSIONS[path.extname(filePath).toLowerCase()] ?? null;
}

/**
 * Open any supported file: parquet routes to the data viewer, everything
 * else to the text-based document reader. Used by the Open dialog.
 */
export function openFile(
  filePath: string,
): Promise<FileDocument | ParquetDocument> {
  return getDocumentKind(filePath) === "parquet"
    ? readParquet(filePath)
    : readDocument(filePath);
}

export async function readParquet(filePath: string): Promise<ParquetDocument> {
  const absolutePath = path.resolve(filePath);
  const stats = await fs.stat(absolutePath);
  const file = await asyncBufferFromFile(absolutePath);
  const metadata = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  const totalRows = Number(metadata.num_rows);
  const columns = schema.children.map((child) => ({
    name: child.element.name,
    type: describeColumnType(child),
  }));
  const rows = await readParquetRows(
    absolutePath,
    0,
    Math.min(PARQUET_PAGE_SIZE, totalRows),
  );
  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    kind: "parquet",
    updatedAt: stats.mtimeMs,
    fileSize: stats.size,
    columns,
    totalRows,
    pageSize: PARQUET_PAGE_SIZE,
    rows,
  };
}

export async function readParquetPage(
  filePath: string,
  rowStart: number,
  rowEnd: number,
): Promise<ParquetPage> {
  const start = Number.isSafeInteger(rowStart) ? Math.max(0, rowStart) : 0;
  const end = Number.isSafeInteger(rowEnd) ? Math.max(0, rowEnd) : start;
  return { rows: await readParquetRows(path.resolve(filePath), start, end) };
}

/**
 * Page through a Parquet file with optional global filter and sort.
 *
 * Without a filter or sort this reads only the requested page (lazy). With
 * either, the first PARQUET_QUERY_ROW_CAP rows are materialized once (cached
 * per file, invalidated on mtime change) and then filtered/sorted in memory.
 */
export async function queryParquet(
  filePath: string,
  query: ParquetQuery,
): Promise<ParquetQueryResult> {
  const absolutePath = path.resolve(filePath);
  const page = Number.isSafeInteger(query.page) ? Math.max(1, query.page) : 1;
  const filter = typeof query.filter === "string" ? query.filter.trim() : "";
  const sortColumn =
    typeof query.sortColumn === "string" && query.sortColumn.length > 0
      ? query.sortColumn
      : null;
  const sortDirection = query.sortDirection === "desc" ? "desc" : "asc";
  const pageSize = PARQUET_PAGE_SIZE;

  if (!filter && !sortColumn) {
    // Lazy path: fetch only the requested page from disk.
    const rowStart = (page - 1) * pageSize;
    const rows = await readParquetRows(
      absolutePath,
      rowStart,
      rowStart + pageSize,
    );
    const file = await asyncBufferFromFile(absolutePath);
    const metadata = await parquetMetadataAsync(file);
    return {
      rows,
      totalMatching: Number(metadata.num_rows),
      page,
      pageSize,
      scannedRows: Number(metadata.num_rows),
      truncated: false,
    };
  }

  const { rows, truncated } = await materializedRows(absolutePath);
  const filtered = filter
    ? rows.filter((row) => matchesFilter(row, filter))
    : rows;
  if (sortColumn) {
    filtered.sort((a, b) => {
      const cmp = compareCells(a[sortColumn], b[sortColumn]);
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }
  const rowStart = (page - 1) * pageSize;
  return {
    rows: filtered.slice(rowStart, rowStart + pageSize),
    totalMatching: filtered.length,
    page,
    pageSize,
    scannedRows: rows.length,
    truncated,
  };
}

export async function readDocument(filePath: string): Promise<FileDocument> {
  const kind = getDocumentKind(filePath);
  if (!kind)
    throw new Error(
      "Only Markdown (.md, .markdown) and Mermaid (.mmd, .mermaid) files are supported.",
    );
  if (kind === "parquet")
    throw new Error(
      "Parquet files are binary and must be opened through the data viewer.",
    );
  if (kind === "code-graph")
    throw new Error(
      "Use the workspace scanner to open code graph views.",
    );

  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const stats = await fs.stat(absolutePath);
  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    kind,
    content,
    updatedAt: stats.mtimeMs,
  };
}

/** Companion file for diagram comments: `<name>_<tag>.txt` next to the source file. */
export function sidecarPath(filePath: string, tag: string): string {
  const safeTag =
    tag.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "notes";
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}_${safeTag}.txt`,
  );
}

export async function readSidecar(
  filePath: string,
  tag: string,
): Promise<string> {
  try {
    return await fs.readFile(sidecarPath(filePath, tag), "utf8");
  } catch {
    return "";
  }
}

export async function writeSidecar(
  filePath: string,
  tag: string,
  content: string,
): Promise<string> {
  const target = sidecarPath(filePath, tag);
  await fs.writeFile(target, content, "utf8");
  return target;
}

export async function listSupportedFiles(
  directoryPath: string,
): Promise<FileEntry[]> {
  const absolutePath = path.resolve(directoryPath);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(absolutePath, entry.name);
      const kind = getDocumentKind(filePath);
      return kind ? { path: filePath, name: entry.name, kind } : null;
    })
    .filter((entry): entry is FileEntry => entry !== null)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}
