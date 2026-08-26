/**
 * Code Graph Builder — scans a workspace directory, runs LSP analysis on all
 * source files, and constructs nodes + edges for the graph viewer.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { EXTENSION_LANGUAGE_MAP, SCAN_CANCELLED_MESSAGE, } from "../shared/types.js";
import { LspManager, mapSymbolKind } from "./lsp-manager.js";
// ─────────── File discovery ───────────
const SCAN_IGNORE = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    "vendor",
    ".cache",
    ".turbo",
    "coverage",
    ".nyc_output",
]);
const MAX_FILES = 1000;
async function walkDir(dir, files) {
    if (files.length >= MAX_FILES)
        return;
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (files.length >= MAX_FILES)
            break;
        if (entry.isDirectory()) {
            if (SCAN_IGNORE.has(entry.name))
                continue;
            await walkDir(path.join(dir, entry.name), files);
        }
        else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            const language = EXTENSION_LANGUAGE_MAP[ext];
            if (language) {
                files.push({ filePath: path.join(dir, entry.name), language });
            }
        }
    }
}
// ─────────── Bounded concurrency ───────────
/**
 * Run `fn` over `items` with at most `limit` in flight at once, stopping
 * early (no new work started) once `signal` is aborted.
 *
 * Scanning was previously a strictly sequential loop: each file paid its
 * own fixed warm-up delay, and any single slow LSP response blocked every
 * file after it. That is fine for a fast, already-warm server (tsserver on
 * a small project) but made larger workspaces — and especially
 * slow-to-warm-up servers like csharp-ls, which has to load the whole
 * project/solution before it can answer anything — take minutes.
 * LspManager.sendRequest already multiplexes requests by id, so running
 * several files/symbols through it concurrently is safe and turns an O(n)
 * wall-clock cost into roughly O(n / limit).
 */
async function mapWithConcurrency(items, limit, signal, fn) {
    let next = 0;
    async function worker() {
        for (;;) {
            if (signal?.aborted)
                return;
            const index = next++;
            if (index >= items.length)
                return;
            await fn(items[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
const SYMBOL_SCAN_CONCURRENCY = 8;
const REFERENCE_CONCURRENCY = 6;
function flattenSymbols(symbols, filePath, language) {
    const result = [];
    // Track the enclosing symbol's id as we recurse, so nested symbols (a
    // method inside a class, say) link to their real parent instead of every
    // symbol in the file — flat or deeply nested — attaching directly to the
    // file node. Without this a large file's tree layout collapses onto a
    // single row instead of branching by scope.
    function walk(syms, parentId) {
        for (const sym of syms) {
            const id = `${filePath}#${sym.name}`;
            result.push({
                id,
                name: sym.name,
                kind: mapSymbolKind(sym.kind),
                filePath,
                language,
                range: {
                    start: { line: sym.range.start.line, character: sym.range.start.character },
                    end: { line: sym.range.end.line, character: sym.range.end.character },
                },
                detail: sym.detail,
                parentId,
            });
            if (sym.children)
                walk(sym.children, id);
        }
    }
    walk(symbols, undefined);
    return result;
}
// ─────────── Graph construction ───────────
/** Cap how many members a single file's box lists before summarizing the rest. */
const MAX_DISPLAYED_MEMBERS = 20;
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Heuristic: a class/interface "implements" (or extends) another symbol
 * when its own signature text says so, e.g. `class Foo extends Bar`.
 * documentSymbol's `detail` already carries that signature, so this needs
 * no extra LSP calls, just a name match against it.
 */
function isImplementsRelationship(source, target) {
    if (source.kind !== "class" && source.kind !== "interface")
        return false;
    const detail = source.detail ?? "";
    return new RegExp(`\\b(extends|implements)\\b[^{;]*\\b${escapeRegExp(target.name)}\\b`).test(detail);
}
/** One line for a file's member list, e.g. "• render()" — indented by nesting depth. */
function formatMember(sym, depth) {
    const isCallable = sym.kind === "function" || sym.kind === "method";
    const marker = isCallable ? "•" : "◦";
    const suffix = isCallable ? "()" : "";
    return `${"  ".repeat(depth)}${marker} ${sym.name}${suffix}`;
}
/**
 * Builds a graph with one node per FILE — its fields and methods are
 * attached to that node as a member list rather than scattered as their
 * own nodes — and edges only between files, aggregated from every
 * symbol-level reference between them. This reads like a compact class
 * diagram (one box per file/unit, arrows for cross-file relationships)
 * instead of a node-per-symbol graph, which stops being readable well
 * before a real codebase's symbol count.
 */
function buildGraph(workspaceRoot, allSymbols, allReferences, languages) {
    const nodeMap = new Map();
    const edgeMap = new Map();
    const symbolById = new Map(allSymbols.map((s) => [s.id, s]));
    // Depth of each symbol below its file (0 = top-level), used only to
    // indent the member list inside each file's box.
    const depthById = new Map();
    function depthOf(sym) {
        const cached = depthById.get(sym.id);
        if (cached !== undefined)
            return cached;
        const parent = sym.parentId ? symbolById.get(sym.parentId) : undefined;
        const depth = parent ? depthOf(parent) + 1 : 0;
        depthById.set(sym.id, depth);
        return depth;
    }
    for (const sym of allSymbols)
        depthOf(sym);
    // Group symbols by file so each file node can list its members.
    const symbolsByFile = new Map();
    for (const sym of allSymbols) {
        const list = symbolsByFile.get(sym.filePath) ?? [];
        list.push(sym);
        symbolsByFile.set(sym.filePath, list);
    }
    for (const [filePath, symbols] of symbolsByFile) {
        // "Fields and methods attached to the file" means the file's own
        // declarations and a class's members — not every local variable or
        // inline callback the LSP outline nests underneath them. Cap what
        // gets listed to depth 0 (top-level) and depth 1 directly under a
        // class/interface/module (a genuine field or method).
        const displayable = symbols.filter((s) => {
            const depth = depthById.get(s.id) ?? 0;
            if (depth === 0)
                return true;
            if (depth > 1)
                return false;
            const parent = s.parentId ? symbolById.get(s.parentId) : undefined;
            return parent?.kind === "class" || parent?.kind === "interface" || parent?.kind === "module";
        });
        const memberLines = displayable.map((s) => formatMember(s, depthById.get(s.id) ?? 0));
        const shown = memberLines.slice(0, MAX_DISPLAYED_MEMBERS);
        if (memberLines.length > MAX_DISPLAYED_MEMBERS) {
            shown.push(`… +${memberLines.length - MAX_DISPLAYED_MEMBERS} more`);
        }
        const label = [path.relative(workspaceRoot, filePath), "─".repeat(18), ...shown].join("\n");
        nodeMap.set(filePath, {
            id: filePath,
            label,
            type: "file",
            filePath,
            language: symbols[0]?.language,
        });
    }
    // File → file edges: collapse every symbol-level reference onto the pair
    // of files that own the two symbols. A reference that stays inside one
    // file doesn't add a file-level edge.
    for (const ref of allReferences) {
        const sourceSym = symbolById.get(ref.sourceSymbolId);
        const targetSym = symbolById.get(ref.targetSymbolId);
        if (!sourceSym || !targetSym)
            continue;
        if (sourceSym.filePath === targetSym.filePath)
            continue;
        if (!nodeMap.has(sourceSym.filePath) || !nodeMap.has(targetSym.filePath))
            continue;
        const type = isImplementsRelationship(sourceSym, targetSym)
            ? "implements"
            : "references";
        const edgeId = `${sourceSym.filePath}→${targetSym.filePath}:${type}`;
        if (edgeMap.has(edgeId))
            continue;
        edgeMap.set(edgeId, {
            id: edgeId,
            source: sourceSym.filePath,
            target: targetSym.filePath,
            type,
        });
    }
    return {
        nodes: Array.from(nodeMap.values()),
        edges: Array.from(edgeMap.values()),
        workspaceRoot,
        languages,
    };
}
// ─────────── Main scan entry point ───────────
export async function scanWorkspace(workspaceRoot, onProgress, signal) {
    const absRoot = path.resolve(workspaceRoot);
    const name = path.basename(absRoot);
    function checkCancelled() {
        if (signal?.aborted)
            throw new Error(SCAN_CANCELLED_MESSAGE);
    }
    // 1. Discover files
    onProgress?.("Discovering source files…");
    const fileList = [];
    await walkDir(absRoot, fileList);
    fileList.sort((a, b) => a.filePath.localeCompare(b.filePath));
    checkCancelled();
    if (fileList.length === 0) {
        throw new Error("No supported source files found in the workspace directory.");
    }
    // Deduplicate languages
    const languages = [...new Set(fileList.map((f) => f.language))];
    const isPackaged = !!process.resourcesPath;
    onProgress?.(`Found ${fileList.length} files in ${languages.length} languages` +
        (isPackaged ? ` (packaged app, resources: ${process.resourcesPath})` : "") +
        `.`);
    // 2. Start LSP servers
    const lsp = new LspManager(absRoot);
    // If the scan is cancelled while we're mid-request, kill the servers
    // right away instead of leaving in-flight requests to hit their full
    // 30s timeout — LspManager rejects all pending requests on process exit.
    const onAbort = () => {
        void lsp.shutdown();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
        const failedLanguages = [];
        for (const lang of languages) {
            checkCancelled();
            onProgress?.(`Starting ${lang} language server…`);
            try {
                await lsp.startServer(lang);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[CodeGraph] Failed to start ${lang} LSP:`, err);
                failedLanguages.push(`${lang} (${msg})`);
            }
        }
        checkCancelled();
        // If every LSP server failed and we have files, tell the user.
        const startedLangs = languages.filter((l) => lsp.hasServer(l));
        if (startedLangs.length === 0 && fileList.length > 0) {
            throw new Error(`Could not start any language server.\n` +
                failedLanguages.map((f) => `  • ${f}`).join("\n") +
                `\n\nMake sure the required LSP packages are installed:\n` +
                `  npm install typescript-language-server typescript pyright`);
        }
        // 3. Open files and collect symbols (bounded concurrency, see mapWithConcurrency)
        const allSymbols = [];
        const symbolIndex = new Map();
        let emptySymbolFiles = 0;
        let indexedCount = 0;
        await mapWithConcurrency(fileList, SYMBOL_SCAN_CONCURRENCY, signal, async ({ filePath, language }) => {
            if (!lsp.hasServer(language))
                return;
            try {
                const content = await fs.readFile(filePath, "utf8");
                // Send didOpen so the server knows about the file, then wait a tick
                // for the server to enqueue it before requesting symbols.
                lsp.openDocument(language, filePath, content);
                await new Promise((r) => setTimeout(r, 120));
                let docSymbols = await lsp.getDocumentSymbols(language, filePath);
                // If symbols came back empty, retry once after a longer delay — some
                // LSP servers (tsserver) need extra time to bootstrap the project.
                if (docSymbols.length === 0) {
                    await new Promise((r) => setTimeout(r, 600));
                    docSymbols = await lsp.getDocumentSymbols(language, filePath);
                }
                const symbols = flattenSymbols(docSymbols, filePath, language);
                if (symbols.length === 0)
                    emptySymbolFiles++;
                allSymbols.push(...symbols);
                for (const sym of symbols)
                    symbolIndex.set(sym.id, sym);
            }
            catch (err) {
                console.error(`[CodeGraph] Error processing ${filePath}:`, err);
            }
            finally {
                indexedCount++;
                onProgress?.(`Indexing ${path.relative(absRoot, filePath)} (${indexedCount}/${fileList.length})…`);
            }
        });
        checkCancelled();
        // 4. Collect references for each symbol (sampling: top-level symbols only to limit time)
        onProgress?.("Resolving cross-references…");
        const allReferences = [];
        // Only resolve references for top-level symbols (not nested children) to keep it tractable
        const topLevelSymbols = allSymbols.filter((sym) => {
            // Heuristic: symbols whose id appears exactly once (not nested children that were flattened)
            return allSymbols.filter((s) => s.id === sym.id).length === 1;
        });
        let resolvedCount = 0;
        await mapWithConcurrency(topLevelSymbols, REFERENCE_CONCURRENCY, signal, async (sym) => {
            try {
                const locations = await lsp.getReferences(sym.language, sym.filePath, sym.range.start.line, sym.range.start.character);
                for (const loc of locations) {
                    const targetPath = loc.uri.replace(/^file:\/\//, "");
                    // Find symbols at this location from our index
                    for (const target of allSymbols) {
                        if (target.filePath === targetPath &&
                            target.range.start.line === loc.range.start.line &&
                            target.range.start.character === loc.range.start.character) {
                            if (target.id !== sym.id) {
                                allReferences.push({
                                    sourceSymbolId: sym.id,
                                    targetSymbolId: target.id,
                                    targetName: target.name,
                                    filePath: targetPath,
                                    range: {
                                        start: { line: loc.range.start.line, character: loc.range.start.character },
                                        end: { line: loc.range.end.line, character: loc.range.end.character },
                                    },
                                });
                            }
                            break;
                        }
                    }
                }
            }
            catch {
                // References may not be supported or may fail; skip
            }
            finally {
                resolvedCount++;
                if (resolvedCount % 10 === 0) {
                    onProgress?.(`Resolving references ${resolvedCount}/${topLevelSymbols.length}…`);
                }
            }
        });
        checkCancelled();
        // 5. Build graph
        onProgress?.("Building graph…");
        const graph = buildGraph(absRoot, allSymbols, allReferences, languages);
        // 7. Safety: if the graph is totally empty, warn the user
        if (graph.nodes.length === 0) {
            throw new Error(`No symbols could be extracted from ${fileList.length} source file${fileList.length !== 1 ? "s" : ""}.\n` +
                `Empty files (no symbols returned by LSP): ${emptySymbolFiles}.\n` +
                `Languages detected: ${languages.join(", ") || "none"}.\n` +
                `Successfully started: ${startedLangs.join(", ") || "none"}.\n\n` +
                `This usually happens when the LSP server cannot resolve project dependencies ` +
                `(e.g. tsconfig.json is missing, or node_modules are not available). ` +
                `Make sure the workspace directory contains a valid project structure.`);
        }
        return {
            path: absRoot,
            name,
            kind: "code-graph",
            graph,
            workspaceInfo: {
                root: absRoot,
                name,
                languages,
                fileCount: fileList.length,
                symbolCount: allSymbols.length,
            },
            savedLayout: await loadGraphLayout(absRoot),
        };
    }
    finally {
        // 6. Shutdown LSP servers (idempotent — the abort listener may already
        // have triggered this).
        signal?.removeEventListener("abort", onAbort);
        await lsp.shutdown();
    }
}
// ─────────── Node detail (for selecting a node) ───────────
/**
 * Re-scan a workspace to get detailed info for a single node.
 * This is a lightweight path: open the file, get the content, find references.
 */
export async function getNodeDetailForWorkspace(workspaceRoot, nodeId, graph) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node)
        throw new Error(`Node not found: ${nodeId}`);
    // Read source content
    let sourceContent = "";
    try {
        sourceContent = await fs.readFile(node.filePath, "utf8");
    }
    catch {
        sourceContent = `// Could not read: ${node.filePath}`;
    }
    // Collect references from the graph edges
    const references = [];
    const referencedFiles = new Set();
    const isReferenceEdge = (type) => type === "references" || type === "implements";
    for (const edge of graph.edges) {
        if (edge.source === nodeId && isReferenceEdge(edge.type)) {
            const targetNode = graph.nodes.find((n) => n.id === edge.target);
            if (targetNode) {
                references.push({
                    sourceSymbolId: nodeId,
                    targetSymbolId: edge.target,
                    targetName: targetNode.label,
                    filePath: targetNode.filePath,
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                });
                referencedFiles.add(targetNode.filePath);
            }
        }
        if (edge.target === nodeId && isReferenceEdge(edge.type)) {
            const sourceNode = graph.nodes.find((n) => n.id === edge.source);
            if (sourceNode) {
                referencedFiles.add(sourceNode.filePath);
            }
        }
    }
    return {
        node,
        sourceContent,
        references,
        referencedFiles: Array.from(referencedFiles),
    };
}
// ─────────── Saved layout (persisted into the scanned workspace) ───────────
/** Written into the workspace root so a saved arrangement travels with the codebase (commit it like any other file). */
const LAYOUT_FILENAME = ".orbit-code-graph-layout.json";
/** Read a previously saved layout for this workspace, if any. */
export async function loadGraphLayout(workspaceRoot) {
    try {
        const raw = await fs.readFile(path.join(workspaceRoot, LAYOUT_FILENAME), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Persist the current node arrangement into the workspace so the next scan reuses it. */
export async function saveGraphLayout(workspaceRoot, positions) {
    const layout = { positions, savedAt: new Date().toISOString() };
    await fs.writeFile(path.join(workspaceRoot, LAYOUT_FILENAME), JSON.stringify(layout, null, 2), "utf8");
}
//# sourceMappingURL=code-graph.js.map