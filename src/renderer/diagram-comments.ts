export interface DiagramComment {
  id: string; // node id as it appears in the Mermaid source
  line: number; // 1-based source line where the node is declared
  text: string;
}

export interface SubgraphInfo {
  id: string;
  line: number;
  title: string;
}

/** Companion file name: `<documentName>_<tag>.txt` with a filesystem-safe tag. */
export function sidecarFileName(documentName: string, tag: string): string {
  const safeTag = tag.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'notes';
  return `${documentName}_${safeTag}.txt`;
}

// Sidecar lines look like: [P4] (line 42): Tighten the spacing here
const SIDECAR_LINE = /^\[(.+?)\] \(line (\d+)\): (.*)$/;

export function parseSidecar(content: string): DiagramComment[] {
  const comments: DiagramComment[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const match = SIDECAR_LINE.exec(raw.trim());
    if (match) comments.push({ id: match[1], line: Number(match[2]), text: match[3] });
  }
  return comments;
}

export function serializeSidecar(comments: DiagramComment[]): string {
  if (comments.length === 0) return '';
  return `${comments.map((c) => `[${c.id}] (line ${c.line}): ${c.text}`).join('\n')}\n`;
}

/** Clipboard format: one line per comment referencing the module and its source line. */
export function formatCommentsForClipboard(comments: DiagramComment[], fileName: string): string {
  return comments.map((c) => `${c.id} (${fileName} line ${c.line}): ${c.text}`).join('\n');
}

/** First source line (1-based) where `id` appears as a standalone token. */
export function findNodeLine(source: string, id: string): number | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`);
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (re.test(lines[index])) return index + 1;
  }
  return null;
}

/** Subgraph declarations: `subgraph id["Title"]` → { id, line, title }. */
export function extractSubgraphs(source: string): SubgraphInfo[] {
  const result: SubgraphInfo[] = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*subgraph\s+("?)([A-Za-z0-9_-]+)\1\s*(?:\[(.*)\])?\s*$/.exec(lines[index]);
    if (match) {
      const title = (match[3] ?? '').replace(/^["']|["']$/g, '').trim();
      result.push({ id: match[2], line: index + 1, title });
    }
  }
  return result;
}

/**
 * Mermaid renders each flowchart node as `<g id="<container>-flowchart-<id>-<n>">`
 * where `<container>` is the diagram container's id and `<n>` an occurrence
 * counter. Slice at the last `flowchart-` marker and strip the trailing counter
 * to recover the source id. Node ids may themselves contain digits or dashes,
 * so only the final `-<digits>` segment is removed.
 */
export function nodeIdFromDomId(domId: string): string | null {
  const marker = 'flowchart-';
  const index = domId.lastIndexOf(marker);
  if (index < 0) return null;
  return domId.slice(index + marker.length).replace(/-\d+$/, '');
}
