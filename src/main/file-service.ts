import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DocumentKind, FileDocument, FileEntry } from '../shared/types.js';

const SUPPORTED_EXTENSIONS: Record<string, DocumentKind> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mmd': 'mermaid',
  '.mermaid': 'mermaid',
};

export function getDocumentKind(filePath: string): DocumentKind | null {
  return SUPPORTED_EXTENSIONS[path.extname(filePath).toLowerCase()] ?? null;
}

export async function readDocument(filePath: string): Promise<FileDocument> {
  const kind = getDocumentKind(filePath);
  if (!kind) throw new Error('Only Markdown (.md, .markdown) and Mermaid (.mmd, .mermaid) files are supported.');

  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  const stats = await fs.stat(absolutePath);
  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    kind,
    content,
    updatedAt: stats.mtimeMs,
  };
}

export async function listSupportedFiles(directoryPath: string): Promise<FileEntry[]> {
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
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
