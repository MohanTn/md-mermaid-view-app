export type DocumentKind = 'markdown' | 'mermaid';

export interface FileDocument {
  path: string;
  name: string;
  kind: DocumentKind;
  content: string;
  updatedAt: number;
}

export interface FileEntry {
  path: string;
  name: string;
  kind: DocumentKind;
}

export interface ViewerApi {
  chooseFile: () => Promise<FileDocument | null>;
  openPath: (filePath: string) => Promise<FileDocument>;
  listDirectory: (directoryPath?: string) => Promise<FileEntry[]>;
  onOpenPath: (callback: (filePath: string) => void) => () => void;
}
