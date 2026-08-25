import { describe, expect, it } from 'vitest';
import {
  computeComponents,
  splitIntoSideColumns,
  splitMainAndOrphans,
} from '../src/renderer/graph-layout';
import type { GraphEdge, GraphNode } from '../src/shared/types';

function node(id: string): GraphNode {
  return { id, label: id, type: 'file', filePath: id };
}

function edge(source: string, target: string): GraphEdge {
  return { id: `${source}->${target}`, source, target, type: 'references' };
}

describe('computeComponents', () => {
  it('groups connected nodes together and keeps isolated nodes as their own component', () => {
    const nodes = [node('a'), node('b'), node('c'), node('isolated1'), node('isolated2')];
    const edges = [edge('a', 'b'), edge('b', 'c')];

    const components = computeComponents(nodes, edges);

    expect(components).toHaveLength(3);
    const sizes = components.map((c) => c.length).sort((a, b) => a - b);
    expect(sizes).toEqual([1, 1, 3]);

    // Every node accounted for exactly once.
    const allIds = components.flat().map((n) => n.id).sort();
    expect(allIds).toEqual(['a', 'b', 'c', 'isolated1', 'isolated2'].sort());
  });

  it('treats a two-node reference pair as its own small component, not merged with the main tree', () => {
    const nodes = [node('root'), node('child'), node('pairA'), node('pairB')];
    const edges = [edge('root', 'child'), edge('pairA', 'pairB')];

    const components = computeComponents(nodes, edges);
    expect(components).toHaveLength(2);
  });

  it('returns one component per node when there are no edges', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const components = computeComponents(nodes, []);
    expect(components).toHaveLength(3);
  });
});

describe('splitMainAndOrphans', () => {
  it('picks the largest component as main and leaves the rest as orphans', () => {
    const main = [node('a'), node('b'), node('c')];
    const orphan1 = [node('x')];
    const orphan2 = [node('y')];

    const result = splitMainAndOrphans([orphan1, main, orphan2]);

    expect(result.main).toBe(main);
    expect(result.orphans).toHaveLength(2);
    expect(result.orphans.flat().map((n) => n.id).sort()).toEqual(['x', 'y']);
  });

  it('handles an empty component list', () => {
    expect(splitMainAndOrphans([])).toEqual({ main: [], orphans: [] });
  });
});

describe('splitIntoSideColumns', () => {
  it('alternates orphan groups between left and right to keep both columns balanced', () => {
    const groups = [[node('a')], [node('b')], [node('c')], [node('d')], [node('e')]];

    const { left, right } = splitIntoSideColumns(groups);

    expect(left.map((g) => g[0].id)).toEqual(['a', 'c', 'e']);
    expect(right.map((g) => g[0].id)).toEqual(['b', 'd']);
  });

  it('returns empty columns for no orphans', () => {
    expect(splitIntoSideColumns([])).toEqual({ left: [], right: [] });
  });
});
