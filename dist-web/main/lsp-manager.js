/**
 * LSP Manager — spawns and communicates with language servers via JSON-RPC 2.0
 * over stdin/stdout. One manager instance per workspace.
 *
 * Supported languages:
 *   - TypeScript/JavaScript/React → typescript-language-server (npm)
 *   - Python                     → pyright-langserver (npm)
 *   - Go                         → gopls (system binary)
 *   - C#                         → csharp-ls (system binary)
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Resolve a path inside an npm package, handling both dev and packaged (asar)
 * locations. Returns the absolute path to the package's entry file.
 */
function resolvePackageEntry(packageName, entry) {
    const relative = path.join("node_modules", packageName, entry);
    // Production: look next to app.asar in the Resources directory.
    if (process.resourcesPath) {
        const prodPath = path.join(process.resourcesPath, relative);
        if (existsSync(prodPath))
            return prodPath;
    }
    // Development: resolve relative to the compiled main process (dist/main/).
    const devPath = path.resolve(__dirname, "..", "..", relative);
    if (!existsSync(devPath)) {
        throw new Error(`LSP package "${packageName}" not found at ${devPath}. ` +
            `Install it with: npm install ${packageName}`);
    }
    return devPath;
}
/**
 * Find a usable Node.js runtime.
 *
 * In development, `process.execPath` IS Node — use it directly.
 *
 * In a packaged Electron app, `process.execPath` is the Electron binary.
 * `ELECTRON_RUN_AS_NODE=1` should make it work as Node, but this is
 * brittle across Electron versions and Linux distributions.  We locate a
 * standalone `node` binary instead:
 *
 *   1. `node` from PATH (just try spawning it — fast at startup)
 *   2. Falls back to `process.execPath` + `ELECTRON_RUN_AS_NODE=1`
 */
let _cachedNodeCommand = null;
function resolveNodeCommand() {
    if (_cachedNodeCommand)
        return _cachedNodeCommand;
    // In development: process.execPath IS the node binary.
    if (!process.resourcesPath) {
        _cachedNodeCommand = { command: process.execPath, needsElectronRunAsNode: false };
        return _cachedNodeCommand;
    }
    // In a packaged app: try to find a real `node` on PATH first.
    // Some distros use `node`, some use `nodejs`.
    for (const candidate of ["node", "nodejs"]) {
        try {
            execSync(`"${candidate}" --version`, { timeout: 3000, stdio: "pipe" });
            console.log(`[LSP] Found standalone "${candidate}" on PATH`);
            _cachedNodeCommand = { command: candidate, needsElectronRunAsNode: false };
            return _cachedNodeCommand;
        }
        catch {
            // Not found — try next candidate.
        }
    }
    // Fallback: use the Electron binary with ELECTRON_RUN_AS_NODE=1.
    console.log(`[LSP] No standalone node found, using Electron binary with ELECTRON_RUN_AS_NODE=1`);
    _cachedNodeCommand = { command: process.execPath, needsElectronRunAsNode: true };
    return _cachedNodeCommand;
}
/**
 * Spawn a Node.js-based LSP server.  Uses the project's own node_modules
 * entry points, bypassing `.bin` symlinks that asar packaging destroys.
 */
function resolveNodeLsp(packageName, entry) {
    const entryPath = resolvePackageEntry(packageName, entry);
    return { command: resolveNodeCommand().command, args: [entryPath] };
}
/** Resolve a platform binary (gopls, csharp-ls) from lsp-binaries/. */
function resolvePlatformBinary(name, binaryName) {
    const exeName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
    // Production: alongside app.asar.
    if (process.resourcesPath) {
        const prodPath = path.join(process.resourcesPath, "lsp-binaries", name, exeName);
        if (existsSync(prodPath))
            return prodPath;
    }
    // Development: project root.
    const devPath = path.resolve(__dirname, "..", "..", "lsp-binaries", name, exeName);
    if (existsSync(devPath))
        return devPath;
    // Last resort: try to find it on PATH.
    return binaryName;
}
const SLN_SEARCH_IGNORE = new Set(["node_modules", ".git", "bin", "obj", "dist", "build"]);
/**
 * Find a .sln to hand csharp-ls via --solution. Without one, csharp-ls
 * never loads a Roslyn workspace — every textDocument/documentSymbol
 * request then errors out for every file, silently (no failure at
 * startup, no obvious symptom besides an empty graph). Checks the
 * workspace root first (the common case), then a couple of levels down.
 */
export function findSolutionFile(workspaceRoot, depth = 2) {
    let entries;
    try {
        entries = readdirSync(workspaceRoot, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    const slnHere = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith(".sln"));
    if (slnHere)
        return path.join(workspaceRoot, slnHere.name);
    if (depth <= 0)
        return undefined;
    for (const entry of entries) {
        if (!entry.isDirectory() || SLN_SEARCH_IGNORE.has(entry.name))
            continue;
        const found = findSolutionFile(path.join(workspaceRoot, entry.name), depth - 1);
        if (found)
            return found;
    }
    return undefined;
}
function getServerConfig(language, rootUri, workspaceRoot) {
    switch (language) {
        case "typescript":
        case "javascript":
        case "typescriptreact":
        case "javascriptreact": {
            const tsLsp = resolveNodeLsp("typescript-language-server", "lib/cli.mjs");
            // --log-level 4 = verbose (helps diagnose crashes in packaged app)
            return {
                command: tsLsp.command,
                args: [...tsLsp.args, "--stdio", "--log-level", "4"],
                rootUri,
                initializationOptions: {
                    preferences: { includeCompletionsForModuleExports: false },
                },
            };
        }
        case "python": {
            const pyLsp = resolveNodeLsp("pyright", "langserver.index.js");
            return {
                command: pyLsp.command,
                args: [...pyLsp.args, "--stdio"],
                rootUri,
            };
        }
        case "go":
            return {
                command: resolvePlatformBinary("gopls", "gopls"),
                args: ["serve"],
                rootUri,
            };
        case "csharp": {
            const solution = findSolutionFile(workspaceRoot);
            if (!solution) {
                console.warn(`[LSP] No .sln found under ${workspaceRoot} — csharp-ls will have no ` +
                    `Roslyn workspace loaded, so document symbols will fail for every file.`);
            }
            return {
                command: resolvePlatformBinary("csharp-ls", "csharp-ls"),
                args: solution ? ["--solution", solution] : [],
                rootUri,
                // csharp-ls resolves --solution relative to its CWD; the default
                // CWD below is the Electron app's own directory, not the scanned
                // workspace, so it must be pinned here regardless.
                cwd: workspaceRoot,
            };
        }
        default:
            return null;
    }
}
// ─────────── LSP Manager ───────────
export class LspManager {
    processes = new Map();
    nextId = 1;
    pending = new Map();
    buffers = new Map();
    /** Stderr collected so we can surface crash details to the user. */
    stderrBuffers = new Map();
    rootUri;
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.rootUri = `file://${workspaceRoot}`;
    }
    /** Whether a server is currently running for the given language. */
    hasServer(language) {
        return this.processes.has(language);
    }
    /** Start an LSP server for a language. Idempotent. */
    async startServer(language) {
        if (this.processes.has(language))
            return;
        const config = getServerConfig(language, this.rootUri, this.workspaceRoot);
        if (!config)
            throw new Error(`No LSP server configured for language: ${language}`);
        console.log(`[LSP] Starting ${language} server: ${config.command} ${config.args.join(" ")}`);
        // ELECTRON_RUN_AS_NODE=1 is critical in packaged apps: it tells the
        // Electron binary to behave as plain Node.js instead of creating a
        // BrowserWindow and exiting immediately (which produces code 0).
        //
        // In development this is a no-op because process.execPath IS Node.
        //
        // NODE_PATH + cwd ensure the process finds its npm dependencies in the
        // extraResources that electron-builder copied next to app.asar.
        const nodeInfo = resolveNodeCommand();
        const env = { ...process.env };
        const opts = {
            stdio: ["pipe", "pipe", "pipe"],
            env,
        };
        if (nodeInfo.needsElectronRunAsNode) {
            env.ELECTRON_RUN_AS_NODE = "1";
        }
        // Always set NODE_PATH when we can compute it, so the spawned process can
        // resolve packages like "typescript" from the correct node_modules.
        const nodeModulesDir = process.resourcesPath
            ? path.join(process.resourcesPath, "node_modules")
            : path.resolve(__dirname, "..", "..", "node_modules");
        if (existsSync(nodeModulesDir)) {
            env.NODE_PATH = nodeModulesDir;
            opts.cwd = path.dirname(nodeModulesDir); // walk up from here
        }
        // A server-specific cwd (e.g. csharp-ls needing to resolve --solution
        // relative to the scanned workspace) always wins over the default above.
        if (config.cwd) {
            opts.cwd = config.cwd;
        }
        const proc = spawn(config.command, config.args, opts);
        proc.on("error", (err) => {
            console.error(`[LSP] ${language} process error:`, err.message);
        });
        proc.on("exit", (code, signal) => {
            const stderr = this.stderrBuffers.get(language)?.trim() ?? "";
            const stdout = this.buffers.get(language)?.trim() ?? "";
            const detail = [
                stderr ? `stderr: ${stderr.split("\n").slice(-3).join("\n")}` : "",
                stdout ? `stdout: ${stdout.slice(-200)}` : "",
            ].filter(Boolean).join("\n");
            console.log(`[LSP] ${language} server exited (code=${code}, signal=${signal})${detail ? "\n" + detail : ""}`);
            this.processes.delete(language);
            // Reject all pending requests for this server
            for (const [id, req] of this.pending) {
                req.reject(new Error(`LSP server ${language} exited (code=${code ?? "?"}, signal=${signal ?? "?"}).` +
                    (detail ? `\n${detail}` : "")));
                clearTimeout(req.timer);
                this.pending.delete(id);
            }
        });
        // Collect stdout chunks per-language
        this.buffers.set(language, "");
        this.stderrBuffers.set(language, "");
        if (proc.stdout) {
            proc.stdout.on("data", (chunk) => {
                this.onData(language, chunk.toString("utf8"));
            });
        }
        if (proc.stderr) {
            proc.stderr.on("data", (chunk) => {
                const text = chunk.toString("utf8");
                const prev = this.stderrBuffers.get(language) ?? "";
                // Keep a rolling buffer: last 4KB of stderr.
                this.stderrBuffers.set(language, (prev + text).slice(-4096));
                console.error(`[LSP] ${language} stderr:`, text.slice(0, 300));
            });
        }
        this.processes.set(language, proc);
        // Initialize the server
        const initResult = await this.sendRequest(language, "initialize", {
            processId: process.pid,
            rootUri: this.rootUri,
            capabilities: {
                textDocument: {
                    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                    references: {},
                    definition: { linkSupport: true },
                },
                workspace: {
                    symbol: { dynamicRegistration: true },
                },
            },
            initializationOptions: config.initializationOptions,
        });
        console.log(`[LSP] ${language} initialized:`, initResult.serverInfo?.name ?? "ok");
        // Send initialized notification
        this.sendNotification(language, "initialized", {});
    }
    /** Open a text document in the LSP server. */
    async openDocument(language, filePath, content) {
        const uri = `file://${filePath}`;
        this.sendNotification(language, "textDocument/didOpen", {
            textDocument: {
                uri,
                languageId: language,
                version: 1,
                text: content,
            },
        });
    }
    /** Close a text document in the LSP server. */
    async closeDocument(language, filePath) {
        const uri = `file://${filePath}`;
        this.sendNotification(language, "textDocument/didClose", {
            textDocument: { uri },
        });
    }
    /** Get document symbols (hierarchical). */
    async getDocumentSymbols(language, filePath) {
        const uri = `file://${filePath}`;
        return this.sendRequest(language, "textDocument/documentSymbol", {
            textDocument: { uri },
        });
    }
    /** Get locations where a symbol is referenced. */
    async getReferences(language, filePath, line, character) {
        const uri = `file://${filePath}`;
        try {
            return await this.sendRequest(language, "textDocument/references", {
                textDocument: { uri },
                position: { line, character },
                context: { includeDeclaration: false },
            });
        }
        catch {
            return [];
        }
    }
    /** Get the definition location of a symbol at the given position. */
    async getDefinition(language, filePath, line, character) {
        const uri = `file://${filePath}`;
        try {
            return await this.sendRequest(language, "textDocument/definition", {
                textDocument: { uri },
                position: { line, character },
            });
        }
        catch {
            return null;
        }
    }
    /** Shutdown all servers gracefully. */
    async shutdown() {
        for (const [language, proc] of this.processes) {
            try {
                this.sendNotification(language, "shutdown", null);
                // Don't wait for the response back; just send exit
                setTimeout(() => {
                    this.sendNotification(language, "exit", null);
                    proc.kill();
                }, 500);
            }
            catch {
                proc.kill();
            }
        }
        this.processes.clear();
    }
    // ─────────── Private: JSON-RPC transport ───────────
    onData(language, chunk) {
        const current = (this.buffers.get(language) ?? "") + chunk;
        // LSP spec says \r\n, but real-world Linux servers often send just \n.
        // Split on the Content-Length header boundary.
        const parts = current.split(/(?=Content-Length: \d+\r?\n\r?\n)/);
        // Process every part, including the last: a lone complete response with
        // no trailing message must not be left stranded waiting for more data
        // that may never come. handleMessage re-buffers a genuinely incomplete
        // part itself, so it is safe to hand it every part here.
        for (let i = 0; i < parts.length; i++) {
            this.handleMessage(language, parts[i]);
        }
    }
    handleMessage(language, raw) {
        const headerMatch = raw.match(/Content-Length: (\d+)\r?\n\r?\n/);
        if (!headerMatch)
            return;
        const contentLength = parseInt(headerMatch[1], 10);
        // Find the actual byte offset of the double-newline separator.
        // Accept \r\n\r\n (spec) or \n\n (real-world Linux servers).
        const doubleNlIdx = raw.search(/\r?\n\r?\n/);
        if (doubleNlIdx === -1)
            return;
        const isCrlf = raw[doubleNlIdx] === "\r";
        const bodyStart = doubleNlIdx + (isCrlf ? 4 : 2);
        const body = raw.slice(bodyStart, bodyStart + contentLength);
        if (body.length < contentLength) {
            // Incomplete — push back to buffer so the next chunk completes it.
            this.buffers.set(language, raw);
            return;
        }
        // Complete — clear any leftover buffer now that this part is consumed.
        this.buffers.set(language, "");
        try {
            const message = JSON.parse(body);
            if ("id" in message && typeof message.id === "number") {
                const pending = this.pending.get(message.id);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(message.id);
                    if (message.error) {
                        pending.reject(new Error(message.error.message));
                    }
                    else {
                        pending.resolve(message.result);
                    }
                }
            }
            // Notifications (no id) are ignored for now
        }
        catch (err) {
            console.error(`[LSP] ${language} parse error:`, err);
        }
    }
    sendRequest(language, method, params) {
        const proc = this.processes.get(language);
        if (!proc?.stdin) {
            return Promise.reject(new Error(`LSP server not running for ${language}`));
        }
        const id = this.nextId++;
        const request = {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        const content = JSON.stringify(request);
        const header = `Content-Length: ${Buffer.byteLength(content, "utf8")}\r\n\r\n`;
        proc.stdin.write(header + content);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`LSP request ${method} timed out for ${language}`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve: resolve, reject, timer });
        });
    }
    sendNotification(language, method, params) {
        const proc = this.processes.get(language);
        if (!proc?.stdin)
            return;
        const notification = {
            jsonrpc: "2.0",
            method,
            params,
        };
        const content = JSON.stringify(notification);
        const header = `Content-Length: ${Buffer.byteLength(content, "utf8")}\r\n\r\n`;
        proc.stdin.write(header + content);
    }
}
// ─────────── Symbol kind mapping (LSP symbol kind numbers → our types) ───────────
export function mapSymbolKind(kind) {
    // LSP SymbolKind values
    switch (kind) {
        case 1: return "file"; // File
        case 2: return "module"; // Module
        case 3: return "module"; // Namespace
        case 4: return "module"; // Package
        case 5: return "class"; // Class
        case 6: return "method"; // Method
        case 7: return "variable"; // Property
        case 8: return "variable"; // Field
        case 9: return "function"; // Constructor
        case 10: return "module"; // Enum (treat as module-level)
        case 11: return "interface"; // Interface
        case 12: return "function"; // Function
        case 13: return "variable"; // Variable
        case 14: return "variable"; // Constant
        case 15: return "type"; // String (LSP: String kind)
        case 16: return "type"; // Number
        case 17: return "type"; // Boolean
        case 18: return "type"; // Array
        case 19: return "type"; // Object
        case 20: return "type"; // Key
        case 21: return "type"; // Null
        case 22: return "type"; // EnumMember
        case 23: return "type"; // Struct
        case 24: return "type"; // Event
        case 25: return "type"; // Operator
        case 26: return "type"; // TypeParameter
        default: return "variable";
    }
}
//# sourceMappingURL=lsp-manager.js.map