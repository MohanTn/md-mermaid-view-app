import { createReadStream } from "node:fs";
import { mkdirSync, promises as fs, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDocumentKind,
  listSupportedFiles,
  openFile,
  queryParquet,
  readDocument,
  readParquetPage,
  readSidecar,
  sidecarPath,
  writeSidecar,
} from "../main/file-service.js";
import {
  getNodeDetailForWorkspace,
  saveGraphLayout,
  scanWorkspace,
} from "../main/code-graph.js";
import type {
  CodeGraphDocument,
  FileDocument,
  FileEntry,
  GraphEdge,
  GraphNode,
  NodeDetail,
  ParquetDocument,
  ParquetPage,
  ParquetQueryResult,
  SavedGraphLayout,
} from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(__dirname, "../renderer");
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT ?? "/workspace");
mkdirSync(workspaceRoot, { recursive: true });
const workspaceRealRoot = realpathSync(workspaceRoot);
const port = Number(process.env.PORT ?? 5222);
const host = process.env.HOST ?? "0.0.0.0";
const WEB_ROOT = "web://workspace";

let cachedGraph: CodeGraphDocument | null = null;
let currentScanAbort: AbortController | null = null;

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toWebPath(filePath: string): string {
  const relative = path.relative(workspaceRealRoot, path.resolve(filePath));
  if (!relative || relative === ".") return WEB_ROOT;
  return `${WEB_ROOT}/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function fromWebPath(value: string | null | undefined, allowRoot = false): string {
  if (!value || value === WEB_ROOT) {
    if (allowRoot) return workspaceRealRoot;
    throw new Error("A workspace file path is required.");
  }
  if (!value.startsWith(`${WEB_ROOT}/`))
    throw new Error("Invalid workspace path.");
  const encodedSegments = value.slice(`${WEB_ROOT}/`.length).split("/");
  let relative: string;
  try {
    relative = encodedSegments.map(decodeURIComponent).join(path.sep);
  } catch {
    throw new Error("Invalid workspace path encoding.");
  }
  const absolute = path.resolve(workspaceRoot, relative);
  let canonical: string;
  try {
    canonical = realpathSync(absolute);
  } catch {
    throw new Error("Workspace file does not exist.");
  }
  if (!isInsideRoot(workspaceRealRoot, canonical)) throw new Error("Workspace path escapes the configured root.");
  return canonical;
}

function mapFileEntry(entry: FileEntry): FileEntry {
  return { ...entry, path: toWebPath(entry.path) };
}

function mapSymbolId(symbolId: string): string {
  const separator = symbolId.lastIndexOf("#");
  return separator < 0
    ? toWebPath(symbolId)
    : `${toWebPath(symbolId.slice(0, separator))}${symbolId.slice(separator)}`;
}

function mapGraphDocument(document: CodeGraphDocument): CodeGraphDocument {
  const graph = document.graph;
  const nodes: GraphNode[] = graph.nodes.map((node) => ({
    ...node,
    id: toWebPath(node.id),
    filePath: toWebPath(node.filePath),
  }));
  const edges: GraphEdge[] = graph.edges.map((edge) => ({
    ...edge,
    id: `${toWebPath(edge.source)}->${toWebPath(edge.target)}:${edge.type}`,
    source: toWebPath(edge.source),
    target: toWebPath(edge.target),
  }));
  const savedLayout: SavedGraphLayout | null = document.savedLayout
    ? {
        ...document.savedLayout,
        positions: Object.fromEntries(
          Object.entries(document.savedLayout.positions).map(([id, position]) => [
            toWebPath(id),
            position,
          ]),
        ),
      }
    : null;
  return {
    ...document,
    path: toWebPath(document.path),
    graph: { ...graph, nodes, edges, workspaceRoot: WEB_ROOT },
    workspaceInfo: { ...document.workspaceInfo, root: WEB_ROOT },
    savedLayout,
  };
}

function mapNodeDetail(detail: NodeDetail): NodeDetail {
  return {
    ...detail,
    node: {
      ...detail.node,
      id: toWebPath(detail.node.id),
      filePath: toWebPath(detail.node.filePath),
    },
    references: detail.references.map((reference) => ({
      ...reference,
      sourceSymbolId: mapSymbolId(reference.sourceSymbolId),
      targetSymbolId: mapSymbolId(reference.targetSymbolId),
      filePath: toWebPath(reference.filePath),
    })),
    referencedFiles: detail.referencedFiles.map(toWebPath),
  };
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = jsonValue(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendError(response: ServerResponse, status: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, status, { error: message });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function queryPath(url: URL): string {
  return fromWebPath(url.searchParams.get("path"));
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  try {
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/files" && request.method === "GET") {
      const directory = fromWebPath(url.searchParams.get("directory") ?? WEB_ROOT, true);
      const entries = await listSupportedFiles(directory);
      sendJson(response, 200, entries.map(mapFileEntry));
      return;
    }

    if (url.pathname === "/api/document" && request.method === "GET") {
      const document = await readDocument(queryPath(url));
      sendJson(response, 200, { ...document, path: toWebPath(document.path) });
      return;
    }

    if (url.pathname === "/api/parquet" && request.method === "GET") {
      const document = await openFile(queryPath(url)) as ParquetDocument;
      sendJson(response, 200, { ...document, path: toWebPath(document.path) });
      return;
    }

    if (url.pathname === "/api/parquet/page" && request.method === "GET") {
      const rowStart = Number(url.searchParams.get("rowStart") ?? 0);
      const rowEnd = Number(url.searchParams.get("rowEnd") ?? rowStart);
      const page = await readParquetPage(queryPath(url), rowStart, rowEnd);
      sendJson(response, 200, page satisfies ParquetPage);
      return;
    }

    if (url.pathname === "/api/parquet/query" && request.method === "POST") {
      const body = await readBody(request) as { path?: string; query?: Parameters<typeof queryParquet>[1] };
      const result = await queryParquet(fromWebPath(body.path), body.query ?? { page: 1 });
      sendJson(response, 200, result satisfies ParquetQueryResult);
      return;
    }

    if (url.pathname === "/api/sidecar" && request.method === "GET") {
      sendJson(response, 200, {
        content: await readSidecar(queryPath(url), url.searchParams.get("tag") ?? "notes"),
      });
      return;
    }

    if (url.pathname === "/api/sidecar" && request.method === "PUT") {
      const body = await readBody(request) as { path?: string; tag?: string; content?: string };
      const sourcePath = fromWebPath(body.path);
      const target = sidecarPath(sourcePath, body.tag ?? "notes");
      const canonicalTarget = await fs
        .realpath(target)
        .catch(() => path.resolve(target));
      if (!isInsideRoot(workspaceRealRoot, canonicalTarget)) {
        throw new Error("Sidecar path is outside the workspace.");
      }
      await writeSidecar(sourcePath, body.tag ?? "notes", body.content ?? "");
      sendJson(response, 200, { path: toWebPath(target) });
      return;
    }

    if (url.pathname === "/api/graph/scan" && request.method === "POST") {
      const body = await readBody(request) as { directoryPath?: string };
      const root = fromWebPath(body.directoryPath ?? WEB_ROOT, true);
      const abort = new AbortController();
      currentScanAbort = abort;
      try {
        const document = await scanWorkspace(root, undefined, abort.signal);
        cachedGraph = document;
        sendJson(response, 200, mapGraphDocument(document));
      } finally {
        if (currentScanAbort === abort) currentScanAbort = null;
      }
      return;
    }

    if (url.pathname === "/api/graph/cancel" && request.method === "POST") {
      currentScanAbort?.abort();
      sendJson(response, 200, { cancelled: true });
      return;
    }

    if (url.pathname === "/api/graph/node" && request.method === "GET") {
      if (!cachedGraph) throw new Error("No workspace graph loaded.");
      const nodeId = fromWebPath(url.searchParams.get("nodeId"));
      const detail = await getNodeDetailForWorkspace(cachedGraph.graph.workspaceRoot, nodeId, cachedGraph.graph);
      sendJson(response, 200, mapNodeDetail(detail));
      return;
    }

    if (url.pathname === "/api/graph/layout" && request.method === "PUT") {
      const body = await readBody(request) as {
        workspaceRoot?: string;
        positions?: Record<string, { x: number; y: number }>;
      };
      const root = fromWebPath(body.workspaceRoot ?? WEB_ROOT, true);
      const positions = Object.fromEntries(
        Object.entries(body.positions ?? {}).map(([id, position]) => [fromWebPath(id), position]),
      );
      await saveGraphLayout(root, positions);
      sendJson(response, 200, { saved: true });
      return;
    }

    sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    sendError(response, status, error);
  }
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[extension] ?? "application/octet-stream";
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const decoded = decodeURIComponent(pathname);
  const requested = path.resolve(rendererRoot, `.${decoded}`);
  const filePath = isInsideRoot(rendererRoot, requested) ? requested : path.join(rendererRoot, "index.html");
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error("Not a file");
    if (path.basename(filePath) === "index.html") {
      let html = await fs.readFile(filePath, "utf8");
      html = html.replace("</head>", "<script>window.__ORBIT_WEB__=true;</script></head>");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
    } else {
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      createReadStream(filePath).pipe(response);
    }
  } catch {
    const indexPath = path.join(rendererRoot, "index.html");
    let html = await fs.readFile(indexPath, "utf8");
    html = html.replace("</head>", "<script>window.__ORBIT_WEB__=true;</script></head>");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  }
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (requestUrl.pathname.startsWith("/api/")) {
    void handleApi(request, response, requestUrl);
    return;
  }
  void serveStatic(response, requestUrl.pathname).catch((error) => sendError(response, 500, error));
});

server.listen(port, host, () => {
  console.log(`Orbit MD Viewer web server listening on http://${host}:${port}`);
  console.log(`Workspace root: ${workspaceRoot}`);
});

function shutdown(): void {
  currentScanAbort?.abort();
  server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
