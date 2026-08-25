import { useCallback, useEffect } from "react";
import type {
  FileDocument,
  FileEntry,
  ParquetDocument,
  CodeGraphDocument,
} from "../../shared/types";
import { addToHistory, type HistoryEntry } from "../history";

function isParquetPath(filePath: string): boolean {
  return /\.parquet$/i.test(filePath);
}

interface UseFileLoaderParams {
  setDocument: (doc: FileDocument | ParquetDocument | CodeGraphDocument | null) => void;
  setFiles: (files: FileEntry[]) => void;
  setHistory: (history: HistoryEntry[]) => void;
  setDirectory: (dir: string) => void;
  setError: (msg: string) => void;
  /** Called after a successful file load to reset zoom and editor state. */
  onFileOpened: () => void;
}

export interface UseFileLoaderResult {
  loadFile: (filePath: string) => Promise<void>;
  chooseFile: () => Promise<void>;
}

export function useFileLoader({
  setDocument,
  setFiles,
  setHistory,
  setDirectory,
  setError,
  onFileOpened,
}: UseFileLoaderParams): UseFileLoaderResult {
  const loadFile = useCallback(
    async (filePath: string) => {
      try {
        setError("");
        const loaded = isParquetPath(filePath)
          ? await window.viewer.openParquet(filePath)
          : await window.viewer.openPath(filePath);
        setDocument(loaded);
        onFileOpened();
        setHistory(
          addToHistory({
            path: loaded.path,
            name: loaded.name,
            kind: loaded.kind,
          }),
        );
        const fileDirectory = loaded.path.replace(/[\\/][^\\/]+$/, "");
        setDirectory(fileDirectory);
        setFiles(await window.viewer.listDirectory(fileDirectory));
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      }
    },
    [setDocument, setFiles, setHistory, setDirectory, setError, onFileOpened],
  );

  const chooseFile = useCallback(async () => {
    try {
      const selected = await window.viewer.chooseFile();
      if (selected) await loadFile(selected.path);
    } catch (chooseError) {
      setError(
        chooseError instanceof Error
          ? chooseError.message
          : String(chooseError),
      );
    }
  }, [loadFile, setError]);

  // ─────────── OS "open with" file event ───────────
  useEffect(() => {
    return window.viewer.onOpenPath((filePath: string) => {
      void loadFile(filePath);
    });
  }, [loadFile]);

  return { loadFile, chooseFile };
}
