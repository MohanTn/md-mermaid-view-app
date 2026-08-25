/**
 * Downloads platform-specific LSP server binaries (gopls, csharp-ls) into
 * `lsp-binaries/` so they can be bundled as extraResources by electron-builder.
 *
 * Usage: node scripts/download-lsp-binaries.mjs
 *
 * Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { execSync } from "node:child_process";
import { createUnzip } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARIES_DIR = join(__dirname, "..", "lsp-binaries");
const platform = process.platform; // linux, darwin, win32
const arch = process.arch;       // x64, arm64

// ─────────── gopls ───────────

// gopls releases: https://github.com/golang/tools/releases
const GOPLS_VERSION = "0.16.2";

const GOPLS_ASSETS = {
  "linux-x64": `gopls_${GOPLS_VERSION}_linux_amd64.tar.gz`,
  "linux-arm64": `gopls_${GOPLS_VERSION}_linux_arm64.tar.gz`,
  "darwin-x64": `gopls_${GOPLS_VERSION}_darwin_amd64.tar.gz`,
  "darwin-arm64": `gopls_${GOPLS_VERSION}_darwin_arm64.tar.gz`,
  "win32-x64": `gopls_${GOPLS_VERSION}_windows_amd64.zip`,
};

// ─────────── csharp-ls ───────────

// csharp-ls (formerly omnisharp-roslyn) uses the .NET LSP server
// Using the standalone csharp-ls binary distribution
const CSHARP_LS_VERSION = "0.14.0";

const CSHARP_LS_ASSETS = {
  "linux-x64": `csharp-ls-${CSHARP_LS_VERSION}-linux-x64.tar.gz`,
  "linux-arm64": `csharp-ls-${CSHARP_LS_VERSION}-linux-arm64.tar.gz`,
  "darwin-x64": `csharp-ls-${CSHARP_LS_VERSION}-osx-x64.tar.gz`,
  "darwin-arm64": `csharp-ls-${CSHARP_LS_VERSION}-osx-arm64.tar.gz`,
  "win32-x64": `csharp-ls-${CSHARP_LS_VERSION}-win-x64.zip`,
};

// ─────────── Helpers ───────────

async function downloadFile(url, dest) {
  console.log(`  Downloading ${url}…`);
  const file = createWriteStream(dest);
  await new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        file.close();
        downloadFile(response.headers.location, dest).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }
      response.pipe(file);
      file.on("finish", resolve);
      file.on("error", reject);
    }).on("error", reject);
  });
}

async function extractTarGz(tarball, destDir) {
  console.log(`  Extracting ${tarball}…`);
  // Use system tar command
  execSync(`tar -xzf "${tarball}" -C "${destDir}"`, { stdio: "pipe" });
}

async function extractZip(zipfile, destDir) {
  console.log(`  Extracting ${zipfile}…`);
  execSync(`unzip -o "${zipfile}" -d "${destDir}"`, { stdio: "pipe" });
}

// ─────────── Main ───────────

async function main() {
  mkdirSync(BINARIES_DIR, { recursive: true });

  const currentPlatform = `${platform}-${arch}`;
  console.log(`Platform: ${currentPlatform}`);

  // ── gopls ──
  const goplsAsset = GOPLS_ASSETS[currentPlatform];
  if (goplsAsset) {
    console.log(`\n--- gopls v${GOPLS_VERSION} ---`);
    const goplsDir = join(BINARIES_DIR, "gopls");
    mkdirSync(goplsDir, { recursive: true });

    const destPath = join(goplsDir, goplsAsset);
    const goplsBinPath = join(goplsDir, platform === "win32" ? "gopls.exe" : "gopls");

    if (existsSync(goplsBinPath)) {
      console.log(`  gopls already exists at ${goplsBinPath}, skipping.`);
    } else {
      const url = `https://github.com/golang/tools/releases/download/gopls%2Fv${GOPLS_VERSION}/${goplsAsset}`;
      try {
        await downloadFile(url, destPath);
        if (goplsAsset.endsWith(".tar.gz")) {
          await extractTarGz(destPath, goplsDir);
        } else {
          await extractZip(destPath, goplsDir);
        }
        // Make executable
        if (platform !== "win32") {
          chmodSync(goplsBinPath, 0o755);
        }
        console.log(`  ✓ gopls installed to ${goplsBinPath}`);
      } catch (err) {
        console.error(`  ✗ Failed to download gopls: ${err.message}`);
        console.log(`  You can install gopls manually: go install golang.org/x/tools/gopls@v${GOPLS_VERSION}`);
      }
    }
  } else {
    console.log(`  No gopls asset for ${currentPlatform}, skipping.`);
  }

  // ── csharp-ls ──
  const csharpAsset = CSHARP_LS_ASSETS[currentPlatform];
  if (csharpAsset) {
    console.log(`\n--- csharp-ls v${CSHARP_LS_VERSION} ---`);
    const csharpDir = join(BINARIES_DIR, "csharp-ls");
    mkdirSync(csharpDir, { recursive: true });

    const destPath = join(csharpDir, csharpAsset);
    const csharpBinName = platform === "win32" ? "csharp-ls.exe" : "csharp-ls";
    // csharp-ls may be nested in subdirectory after extraction
    const csharpBinPath = join(csharpDir, csharpBinName);

    // Also check for nested path
    const nestedBinPath = join(csharpDir, `csharp-ls-${CSHARP_LS_VERSION}`, csharpBinName);
    const effectiveBinPath = existsSync(nestedBinPath) ? nestedBinPath : csharpBinPath;

    if (existsSync(csharpBinPath) || existsSync(nestedBinPath)) {
      console.log(`  csharp-ls already exists, skipping.`);
    } else {
      // csharp-ls is hosted on GitHub
      const url = `https://github.com/razzmatazz/csharp-language-server/releases/download/v${CSHARP_LS_VERSION}/${csharpAsset}`;
      try {
        await downloadFile(url, destPath);
        if (csharpAsset.endsWith(".tar.gz")) {
          await extractTarGz(destPath, csharpDir);
        } else {
          await extractZip(destPath, csharpDir);
        }
        // Make executable
        const finalBin = existsSync(nestedBinPath) ? nestedBinPath : csharpBinPath;
        if (platform !== "win32" && existsSync(finalBin)) {
          chmodSync(finalBin, 0o755);
        }
        console.log(`  ✓ csharp-ls installed to ${finalBin}`);
      } catch (err) {
        console.error(`  ✗ Failed to download csharp-ls: ${err.message}`);
        console.log(`  You can install csharp-ls manually or use omnisharp-roslyn.`);
      }
    }
  } else {
    console.log(`  No csharp-ls asset for ${currentPlatform}, skipping.`);
  }

  console.log("\nDone. LSP binaries are in lsp-binaries/");
  console.log("Add this to electron-builder config:");
  console.log('  "extraResources": [{ "from": "lsp-binaries", "to": "lsp-binaries" }]');
}

main().catch(console.error);