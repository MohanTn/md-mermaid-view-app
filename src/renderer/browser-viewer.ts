import type {
  FileDocument,
  FileEntry,
  ParquetDocument,
  ParquetPage,
  ParquetQueryResult,
  ViewerApi,
  CodeGraphDocument,
  NodeDetail,
} from "../shared/types";

interface BrowserFile {
  path: string;
  document: FileDocument;
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

function unsupportedParquet(): never {
  throw new Error(
    "Parquet files are available in the Electron app; browser preview supports Markdown and Mermaid files.",
  );
}

/**
 * Small in-memory/browser-storage implementation used when the renderer is
 * opened through Vite instead of Electron. It keeps the renderer interactive
 * without pretending a browser can access arbitrary local paths.
 */
export function createBrowserViewerApi(): ViewerApi {
  const files = new Map<string, BrowserFile>();
  let nextId = 1;

  const openBrowserFile = async (file: File): Promise<FileDocument> => {
    const kind = documentKind(file.name);
    if (!kind)
      throw new Error(
        "Choose a Markdown (.md, .markdown) or Mermaid (.mmd, .mermaid) file.",
      );
    const path = `browser://${nextId++}-${encodeURIComponent(file.name)}`;
    const document: FileDocument = {
      path,
      name: file.name,
      kind,
      content: await file.text(),
      updatedAt: file.lastModified || Date.now(),
    };
    files.set(path, { path, document });
    return document;
  };

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
      const file = files.get(filePath);
      if (!file)
        throw new Error(
          "That browser-preview file is no longer available. Choose it again.",
        );
      return file.document;
    },

    async listDirectory(): Promise<FileEntry[]> {
      return Array.from(files.values()).map(({ document }) => ({
        path: document.path,
        name: document.name,
        kind: document.kind,
      }));
    },

    onOpenPath(): () => void {
      return () => undefined;
    },

    async readSidecar(filePath: string, tag: string): Promise<string> {
      return window.localStorage.getItem(sidecarKey(filePath, tag)) ?? "";
    },

    async writeSidecar(
      filePath: string,
      tag: string,
      content: string,
    ): Promise<string> {
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

    async openParquet(): Promise<ParquetDocument> {
      return unsupportedParquet();
    },
    async openParquetPage(): Promise<ParquetPage> {
      return unsupportedParquet();
    },
    async queryParquet(): Promise<ParquetQueryResult> {
      return unsupportedParquet();
    },

    // ── Code graph (browser unsupported) ──
    async openWorkspace(): Promise<CodeGraphDocument | null> {
      throw new Error("Code graph is available in the Electron app only.");
    },
    async scanWorkspace(): Promise<CodeGraphDocument> {
      throw new Error("Code graph is available in the Electron app only.");
    },
    async cancelScan(): Promise<void> {
      // No-op: the browser dev preview never starts a scan to cancel.
    },
    async getNodeDetail(): Promise<NodeDetail> {
      throw new Error("Code graph is available in the Electron app only.");
    },
    async saveGraphLayout(): Promise<void> {
      throw new Error("Code graph is available in the Electron app only.");
    },
    onScanProgress(): () => void {
      return () => undefined;
    },
  };
}

export function installBrowserViewer(): void {
  if (!window.viewer) window.viewer = createBrowserViewerApi();
}
