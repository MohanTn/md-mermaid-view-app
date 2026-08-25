import React, { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import type { CodeGraph, GraphNode, SavedGraphLayout } from "../../shared/types";
import { ReferencePanel } from "./reference-panel";
import { computeComponents, splitIntoSideColumns, splitMainAndOrphans } from "../graph-layout";

interface CodeGraphViewProps {
  graph: CodeGraph;
  workspaceRoot: string;
  savedLayout: SavedGraphLayout | null;
  onError: (message: string) => void;
}

/** Above this many nodes, a breadthfirst tree's same-depth row gets too dense to read — fall back to cose. */
const TREE_LAYOUT_MAX_NODES = 150;
/** Horizontal gap between the main tree and each side column of reference-less files. */
const ORPHAN_SIDE_GAP = 160;
/** Vertical gap stacking one orphan file below the previous one in its column. */
const ORPHAN_STACK_GAP = 50;

/**
 * Cytoscape stylesheet for graph nodes/edges — a flat, hand-drawn-diagram
 * look: uniform rounded boxes on a black canvas, light strokes, no per-type
 * color coding, laid out as a top-down tree rather than a force-directed blob.
 */
const NODE_STYLES = [
  {
    selector: "node",
    style: {
      "background-color": "#111318",
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": "12px",
      color: "#e6e6e6",
      shape: "round-rectangle",
      "border-width": 2,
      "border-color": "#e6e6e6",
      "border-opacity": 0.9,
      "corner-radius": "10",
      // Each node's label is the file name plus its member list (see
      // buildGraph) — size the box to fit that text instead of a fixed
      // box, since member-list length varies a lot from file to file.
      width: "label",
      height: "label",
      padding: "14px",
      "text-wrap": "wrap",
      "text-max-width": "260",
      "text-justification": "left",
    },
  },
  {
    selector: "node.selected",
    style: {
      "border-width": 3,
      "border-color": "#f43f5e",
    },
  },
  {
    selector: "node.highlighted",
    style: {
      "border-color": "#f59e0b",
      opacity: 1,
    },
  },
  {
    selector: "node.dimmed",
    style: {
      opacity: 0.25,
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#8a8f98",
      "target-arrow-color": "#8a8f98",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.9,
      "curve-style": "taxi",
      "taxi-direction": "downward",
      "taxi-turn": "50%",
      opacity: 0.9,
    },
  },
  {
    selector: "edge[type='references']",
    style: {
      "line-style": "dashed",
      opacity: 0.35,
    },
  },
  {
    selector: "edge[type='implements']",
    style: {
      "line-color": "#60a5fa",
      "target-arrow-color": "#60a5fa",
      "target-arrow-shape": "triangle-tee",
      width: 2,
      opacity: 0.9,
    },
  },
  {
    selector: "edge.highlighted",
    style: {
      opacity: 1,
      width: 2.5,
      "line-color": "#f59e0b",
      "target-arrow-color": "#f59e0b",
    },
  },
  {
    selector: "edge.dimmed",
    style: {
      opacity: 0.08,
    },
  },
];

/**
 * Positions every node: either from a saved layout (loaded from the
 * scanned workspace) when it covers every current node, or freshly
 * computed — the main reference tree laid out top-down, and files with no
 * reference to (or from) anything else stacked in two columns flanking it
 * instead of tangled into the tree or scattered by a generic layout.
 */
function computeInitialLayout(
  cy: Core,
  graph: CodeGraph,
  savedLayout: SavedGraphLayout | null,
): void {
  if (savedLayout && graph.nodes.every((n) => savedLayout.positions[n.id] != null)) {
    cy.layout({ name: "preset", positions: savedLayout.positions, fit: true, padding: 40 }).run();
    return;
  }

  const { main, orphans } = splitMainAndOrphans(computeComponents(graph.nodes, graph.edges));
  const mainIds = new Set(main.map((n) => n.id));
  const mainEles = cy
    .nodes()
    .filter((n) => mainIds.has(n.id()))
    .union(cy.edges().filter((e) => mainIds.has(e.data("source")) && mainIds.has(e.data("target"))));

  if (mainEles.length > 0) {
    layoutMainTree(mainEles, graph, main, mainIds);
  }

  if (orphans.length > 0) {
    const bbox = mainEles.length > 0 ? mainEles.boundingBox() : { x1: 0, x2: 0, y1: 0, y2: 0 };
    const { left, right } = splitIntoSideColumns(orphans);
    placeOrphanColumn(cy, left, "left", bbox);
    placeOrphanColumn(cy, right, "right", bbox);
  }

  cy.fit(undefined, 40);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function layoutMainTree(mainEles: any, graph: CodeGraph, main: GraphNode[], mainIds: Set<string>): void {
  // A breadthfirst tree reads cleanly at the size of a single file, but a
  // whole-workspace scan can put hundreds of same-depth siblings on one
  // row — that row ends up thousands of pixels wide and, once fit to the
  // viewport, the uniformly-sized boxes shrink to sub-pixel and the graph
  // looks simply blank. cose (force-directed) spreads dense graphs across
  // both axes instead of one row, so large graphs stay visible.
  const useCose = main.length > TREE_LAYOUT_MAX_NODES;

  mainEles
    .layout(
      useCose
        ? {
            name: "cose",
            animate: false,
            randomize: true,
            nodeRepulsion: () => 150000,
            idealEdgeLength: () => 100,
            padding: 40,
            fit: false,
          }
        : {
            name: "breadthfirst",
            directed: true,
            // Roots are files nothing else in the main tree references.
            roots: (() => {
              const referenced = new Set(
                graph.edges
                  .filter((e) => mainIds.has(e.source) && mainIds.has(e.target))
                  .map((e) => e.target),
              );
              const entryPoints = main.filter((n) => !referenced.has(n.id));
              return (entryPoints.length > 0 ? entryPoints : main).map((n) => n.id);
            })(),
            animate: false,
            spacingFactor: 1.4,
            padding: 40,
            fit: false,
          },
    )
    .run();
}

/** Lays out one side column of orphan groups, stacked top to bottom next to the main tree's bounding box. */
function placeOrphanColumn(
  cy: Core,
  groups: GraphNode[][],
  side: "left" | "right",
  mainBBox: { x1: number; x2: number; y1: number; y2: number },
): void {
  let y = mainBBox.y1;
  for (const group of groups) {
    const ids = new Set(group.map((n) => n.id));
    const groupEles = cy
      .nodes()
      .filter((n) => ids.has(n.id()))
      .union(cy.edges().filter((e) => ids.has(e.data("source")) && ids.has(e.data("target"))));

    groupEles
      .layout({ name: "breadthfirst", directed: true, animate: false, spacingFactor: 1.2, fit: false })
      .run();

    const groupBBox = groupEles.boundingBox();
    const targetCenterX =
      side === "left"
        ? mainBBox.x1 - ORPHAN_SIDE_GAP - groupBBox.w / 2
        : mainBBox.x2 + ORPHAN_SIDE_GAP + groupBBox.w / 2;
    const targetCenterY = y + groupBBox.h / 2;
    const dx = targetCenterX - (groupBBox.x1 + groupBBox.w / 2);
    const dy = targetCenterY - (groupBBox.y1 + groupBBox.h / 2);

    groupEles.nodes().forEach((n: ReturnType<Core["nodes"]>[number]) => {
      const p = n.position();
      n.position({ x: p.x + dx, y: p.y + dy });
    });

    y = targetCenterY + groupBBox.h / 2 + ORPHAN_STACK_GAP;
  }
}

export function CodeGraphView({
  graph,
  workspaceRoot,
  savedLayout,
  onError,
}: CodeGraphViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Build element list from graph
  const elements: ElementDefinition[] = React.useMemo(() => {
    const nodeElements: ElementDefinition[] = graph.nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.label,
        type: node.type,
        filePath: node.filePath,
        detail: node.detail ?? "",
      },
    }));
    const edgeElements: ElementDefinition[] = graph.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
      },
    }));
    return [...nodeElements, ...edgeElements];
  }, [graph]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: NODE_STYLES as any[],
      // Positions are set explicitly right below (preset from a saved
      // layout, or computeInitialLayout) rather than by an initial
      // layout name here.
      wheelSensitivity: 0.2,
    });

    computeInitialLayout(cy, graph, savedLayout);

    // Node click → select + highlight neighbors
    cy.on("tap", "node", (event) => {
      const node = event.target;
      const nodeData = node.data();
      const fullNode: GraphNode = {
        id: nodeData.id,
        label: nodeData.label,
        type: nodeData.type,
        filePath: nodeData.filePath,
        language: graph.nodes.find((n) => n.id === nodeData.id)?.language,
        detail: nodeData.detail || undefined,
      };
      setSelectedNode(fullNode);
      highlightNeighbors(cy, nodeData.id);
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        setSelectedNode(null);
        resetHighlight(cy);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, graph, savedLayout, onError]);

  // Highlight neighbors of the selected node
  function highlightNeighbors(cy: Core, nodeId: string): void {
    resetHighlight(cy);
    const selected = cy.getElementById(nodeId);
    selected.addClass("selected");

    const neighbors = selected.closedNeighborhood();
    neighbors.addClass("highlighted");

    // Dim everything not in the neighborhood
    cy.elements().difference(neighbors).addClass("dimmed");
  }

  function resetHighlight(cy: Core): void {
    cy.elements().removeClass("selected highlighted dimmed");
  }

  async function handleSaveLayout(): Promise<void> {
    const cy = cyRef.current;
    if (!cy) return;
    setSaveState("saving");
    const positions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((n) => {
      positions[n.id()] = n.position();
    });
    try {
      await window.viewer.saveGraphLayout(workspaceRoot, positions);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      setSaveState("idle");
      onError(err instanceof Error ? err.message : "Failed to save the graph layout.");
    }
  }

  return (
    <div className="code-graph-container">
      <div className="code-graph-canvas-wrap">
        <div ref={containerRef} className="code-graph-canvas" />
        <button
          className="graph-save-layout"
          disabled={saveState === "saving"}
          onClick={handleSaveLayout}
          title="Save the current arrangement into this codebase so future scans reuse it"
        >
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Save Layout"}
        </button>
      </div>
      {selectedNode && (
        <ReferencePanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}