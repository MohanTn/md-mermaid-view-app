# Orbit MD Viewer

Orbit is a Markdown, Mermaid, Parquet, and code-graph viewer. It can run as an Electron desktop app or as a browser-hosted web app backed by a small Node server.

## Hosted Web App

The web deployment reads files from a server-side workspace directory. The directory is intentionally scoped so the browser cannot request arbitrary paths from the host.

### Docker Compose

1. Put Markdown, Mermaid, Parquet, or source-code files in `./workspace`.
2. Start the service:

```bash
docker compose up --build -d
```

3. Open <http://localhost:5222>.

The Compose file mounts `./workspace` into `/workspace` in the container. Sidecar comments and saved code-graph layouts are written into that mounted directory. Stop it with:

```bash
docker compose down
```

To use another host directory, change the left side of the volume mapping in `docker-compose.yml` while keeping `/workspace` as the container path.

### Run Without Docker

```bash
npm install
npm run build:web
WORKSPACE_ROOT=/absolute/path/to/workspace npm run start:web
```

The web server listens on `http://localhost:5222` by default. Set `PORT` to change the port.

The hosted web app supports:

- Browsing files in the configured workspace root
- Markdown and Mermaid rendering, including Mermaid comments persisted as sidecar files
- Parquet pagination, filtering, and sorting
- Code graph scanning through the server's language-server processes
- Saving code graph layouts into `.orbit-code-graph-layout.json`

## Electron Development

```bash
npm install
npm run build
npm start
```

`npm run dev` starts the Vite renderer with a browser adapter for local Markdown/Mermaid preview and local comment storage. The hosted deployment is the supported browser mode for Parquet and code-graph features.

## Checks

```bash
npm run typecheck
npm test
npm run build:main
npm run build:renderer
npm run build:web
npm run build
npm run build:deb
```

## Supported Files

- Markdown: `.md`, `.markdown`
- Mermaid: `.mmd`, `.mermaid`
- Parquet: `.parquet` (shown as a paginated table with column types, size, and row count)
- Mermaid fenced blocks inside Markdown files are rendered in place.

The Parquet viewer is powered by [hyparquet](https://github.com/hyparam/hyparquet), a pure-JavaScript Parquet reader; `hyparquet-compressors` adds gzip, brotli, zstd, and lz4 decompression alongside the built-in snappy support.

## Debian Package

Generate only the Linux Debian package locally:

```bash
npm run build:deb
```

The package is written to `release/md-mermaid-viewer_<version>_amd64.deb`. Install it on a Debian or Ubuntu system with:

```bash
sudo apt install ./release/md-mermaid-viewer_1.0.1_amd64.deb
```

Replace the filename with the version that was generated. You can uninstall it with:

```bash
sudo apt remove md-mermaid-viewer
```

The CI workflow builds this package, installs it with `apt`, checks that Debian registered it, and removes it again. The Electron main process forces GTK 3 on Linux because Electron 36 can otherwise crash during startup when GTK 3 and GTK 4 are both installed.

## Releases

Create and push a semantic version tag such as `v1.0.1`. GitHub Actions packages Windows (NSIS installer) and Linux (AppImage and `.deb`), then publishes all artifacts in a GitHub Release. Pull requests run typechecking, tests, renderer/main builds, and a Debian install smoke test.
