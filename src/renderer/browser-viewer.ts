import type {
  CodeGraphDocument,
  FileDocument,
  FileEntry,
  NodeDetail,
  ParquetDocument,
  ParquetPage,
  ParquetQuery,
  ParquetQueryResult,
  ViewerApi,
} from "../shared/types";

interface BrowserFile {
  path: string;
  document: FileDocument;
}

interface WebConfig {
  enabled: boolean;
  apiBase: string;
}

function documentKind(name: string): FileDocument["kind"] | null {
  const extension = name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".mmd" || extension === ".mermaid") return "mermaid";
  return null;
}

function sidecarKey(filePath: string, tag: string): string {
  const safeTag =
    tag.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "notes";
  return `md-mermaid-viewer-browser-sidecar:${filePath}:${safeTag}`;
}

function webConfig(): WebConfig {
  const enabled = Boolean(window.__ORBIT_WEB__);
  return { enabled, apiBase: "" };
}

async function apiRequest<T>(
  config: WebConfig,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${config.apiBase}${pathname}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) {
    throw new Error(
      body && typeof body === "object" && "error" in body && body.error
        ? body.error
        : `Request failed (${response.status}).`,
    );
  }
  return body as T;
}

function apiPath(pathname: string, params: Record<string, string | number>): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  return `${pathname}?${query.toString()}`;
}

function unsupportedParquet(): never {
  throw new Error(
    "Parquet files are available in the hosted web app or Electron app.",
  );
}

/**
 * Browser implementation used for Vite preview and the hosted web app.
 * Hosted mode is enabled by the web server's injected marker and uses the
 * mounted workspace through HTTP; plain Vite mode remains local-file only.
 */
export function createBrowserViewerApi(): ViewerApi {
  const files = new Map<string, BrowserFile>();
  let nextId = 1;
  const config = webConfig();

  const openBrowserFile = async (file: File): Promise<FileDocument> => {
    const kind = documentKind(file.name);
    if (!kind) {
      throw new Error(
        "Choose a Markdown (.md, .markdown) or Mermaid (.mmd, .mermaid) file.",
      );
    }
    const filePath = `browser://${nextId++}-${encodeURIComponent(file.name)}`;
    const document: FileDocument = {
      path: filePath,
      name: file.name,
      kind,
      content: await file.text(),
      updatedAt: file.lastModified || Date.now(),
    };
    files.set(filePath, { path: filePath, document });
    return document;
  };

  const listHostedFiles = async (directoryPath?: string): Promise<FileEntry[]> => {
    const directory = directoryPath ?? "web://workspace";
    return apiRequest<FileEntry[]>(
      config,
      apiPath("/api/files", { directory }),
    );
  };

  const openHostedDocument = async (filePath: string): Promise<FileDocument> =>
    apiRequest<FileDocument>(config, apiPath("/api/document", { path: filePath }));

  const openHostedParquet = async (filePath: string): Promise<ParquetDocument> =>
    apiRequest<ParquetDocument>(config, apiPath("/api/parquet", { path: filePath }));

  return {
    async chooseFile(): Promise<FileDocument | null> {
      const input = window.document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,.mmd,.mermaid";
      input.multiple = true;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value: FileDocument | null): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        input.onchange = () => {
          const selected = Array.from(input.files ?? []);
          if (selected.length === 0) {
            finish(null);
            return;
          }
          void Promise.all(selected.map(openBrowserFile))
            .then((opened) => finish(opened[0] ?? null))
            .catch(reject);
        };
        input.oncancel = () => finish(null);
        input.click();
      });
    },

    async openPath(filePath: string): Promise<FileDocument> {
      const localFile = files.get(filePath);
      if (localFile) return localFile.document;
      if (config.enabled && filePath.startsWith("web://")) {
        return openHostedDocument(filePath);
      }
      throw new Error(
        "That browser-preview file is no longer available. Choose it again.",
      );
    },

    async listDirectory(directoryPath?: string): Promise<FileEntry[]> {
      const localFiles = Array.from(files.values()).map(({ document }) => ({
        path: document.path,
        name: document.name,
        kind: document.kind,
      }));
      // A picked file lives at `browser://…`, so its containing directory is
      // not a workspace path — asking the server for it fails the root check.
      const hosted =
        config.enabled &&
        (directoryPath === undefined || directoryPath.startsWith("web://"));
      if (!hosted) return localFiles;
      return [...(await listHostedFiles(directoryPath)), ...localFiles];
    },

    onOpenPath(): () => void {
      return () => undefined;
    },

    async readSidecar(filePath: string, tag: string): Promise<string> {
      if (config.enabled && filePath.startsWith("web://")) {
        const result = await apiRequest<{ content: string }>(
          config,
          apiPath("/api/sidecar", { path: filePath, tag }),
        );
        return result.content;
      }
      return window.localStorage.getItem(sidecarKey(filePath, tag)) ?? "";
    },

    async writeSidecar(
      filePath: string,
      tag: string,
      content: string,
    ): Promise<string> {
      if (config.enabled && filePath.startsWith("web://")) {
        const result = await apiRequest<{ path: string }>(config, "/api/sidecar", {
          method: "PUT",
          body: JSON.stringify({ path: filePath, tag, content }),
        });
        return result.path;
      }
      window.localStorage.setItem(sidecarKey(filePath, tag), content);
      return `${filePath}_${tag}.txt`;
    },

    async copyText(text: string): Promise<void> {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const textarea = window.document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      window.document.body.appendChild(textarea);
      textarea.select();
      window.document.execCommand("copy");
      textarea.remove();
    },

    async openParquet(filePath: string): Promise<ParquetDocument> {
      if (config.enabled && filePath.startsWith("web://")) return openHostedParquet(filePath);
      return unsupportedParquet();
    },

    async openParquetPage(
      filePath: string,
      rowStart: number,
      rowEnd: number,
    ): Promise<ParquetPage> {
      if (!config.enabled || !filePath.startsWith("web://")) return unsupportedParquet();
      return apiRequest<ParquetPage>(
        config,
        apiPath("/api/parquet/page", { path: filePath, rowStart, rowEnd }),
      );
    },

    async queryParquet(
      filePath: string,
      query: ParquetQuery,
    ): Promise<ParquetQueryResult> {
      if (!config.enabled || !filePath.startsWith("web://")) return unsupportedParquet();
      return apiRequest<ParquetQueryResult>(config, "/api/parquet/query", {
        method: "POST",
        body: JSON.stringify({ path: filePath, query }),
      });
    },

    async openWorkspace(): Promise<CodeGraphDocument | null> {
      if (!config.enabled) {
        throw new Error("Code graph is available in the hosted web app or Electron app.");
      }
      return this.scanWorkspace("web://workspace");
    },

    async scanWorkspace(directoryPath: string): Promise<CodeGraphDocument> {
      if (!config.enabled) {
        throw new Error("Code graph is available in the hosted web app or Electron app.");
      }
      return apiRequest<CodeGraphDocument>(config, "/api/graph/scan", {
        method: "POST",
        body: JSON.stringify({ directoryPath }),
      });
    },

    async cancelScan(): Promise<void> {
      if (config.enabled) {
        await apiRequest(config, "/api/graph/cancel", { method: "POST" });
      }
    },

    async getNodeDetail(nodeId: string): Promise<NodeDetail> {
      if (!config.enabled) {
        throw new Error("Code graph is available in the hosted web app or Electron app.");
      }
      return apiRequest<NodeDetail>(
        config,
        apiPath("/api/graph/node", { nodeId }),
      );
    },

    async saveGraphLayout(
      workspaceRoot: string,
      positions: Record<string, { x: number; y: number }>,
    ): Promise<void> {
      if (!config.enabled) {
        throw new Error("Code graph is available in the hosted web app or Electron app.");
      }
      await apiRequest(config, "/api/graph/layout", {
        method: "PUT",
        body: JSON.stringify({ workspaceRoot, positions }),
      });
    },

    onScanProgress(): () => void {
      return () => undefined;
    },
  };
}

export function installBrowserViewer(): void {
  if (!window.viewer) window.viewer = createBrowserViewerApi();
}
