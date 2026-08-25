/**
 * Pure graph-layout math for the code graph view — kept separate from
 * code-graph-view.tsx so it can be unit tested without pulling in React
 * or Cytoscape (which needs a real canvas to size/measure anything).
 */

import type { GraphEdge, GraphNode } from "../shared/types";

/**
 * Groups nodes into connected components using their edges (direction
 * ignored). Used to separate the main reference tree from files that have
 * no relationship to anything else, so the isolated ones can be arranged
 * in their own side columns instead of getting tangled into the tree.
 */
export function computeComponents(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
  const parent = new Map<string, string>();
  for (const node of nodes) parent.set(node.id, node.id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const edge of edges) {
    if (parent.has(edge.source) && parent.has(edge.target)) union(edge.source, edge.target);
  }

  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const root = find(node.id);
    const list = groups.get(root) ?? [];
    list.push(node);
    groups.set(root, list);
  }
  return Array.from(groups.values());
}

/** Picks the largest component as the main diagram; every other component is an "orphan" group. */
export function splitMainAndOrphans(components: GraphNode[][]): {
  main: GraphNode[];
  orphans: GraphNode[][];
} {
  if (components.length === 0) return { main: [], orphans: [] };
  const sorted = [...components].sort((a, b) => b.length - a.length);
  return { main: sorted[0], orphans: sorted.slice(1) };
}

/**
 * Splits orphan components between a left and right column, alternating
 * so both sides stay roughly balanced in count (matches: "arrange the
 * file with no reference as one below another on both right and left").
 */
export function splitIntoSideColumns(orphanComponents: GraphNode[][]): {
  left: GraphNode[][];
  right: GraphNode[][];
} {
  const left: GraphNode[][] = [];
  const right: GraphNode[][] = [];
  orphanComponents.forEach((group, i) => {
    (i % 2 === 0 ? left : right).push(group);
  });
  return { left, right };
}
