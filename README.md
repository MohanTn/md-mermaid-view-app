# Orbit MD Viewer

Orbit is a minimal Electron desktop viewer for Markdown and Mermaid files. Open a Markdown or Mermaid file and it renders as HTML, with Mermaid diagrams drawn as SVG.

## Development

```bash
npm install
npm run build
npm start
```

`npm run dev` starts the Vite renderer for browser-focused work. Use `npm run build` followed by `npm start` to run the complete Electron shell locally.

## Checks

```bash
npm run typecheck
npm test
npm run build:main
npm run build:renderer
npm run build
npm run build:deb
```

## Supported files

- Markdown: `.md`, `.markdown`
- Mermaid: `.mmd`, `.mermaid`
- Mermaid fenced blocks inside Markdown files are rendered in place.

## Debian package

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
