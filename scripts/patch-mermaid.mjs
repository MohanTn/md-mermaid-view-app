// Patches the built mermaid bundle so long subgraph titles wrap inside the
// cluster's dagre-allocated width instead of widening the cluster box.
//
// Why: mermaid draws the flowchart subgraph box as
//   width = max(dagreWidth, titleWidth + padding)
// but the title is created with `width: Number.POSITIVE_INFINITY` (no wrap,
// no max-width). When a title is wider than the space dagre allocated, the
// box is drawn wider than its layout slot and sibling subgraph boxes overlap.
// Routing the title through the same createText path node labels use (with
// `width: node.width`) makes it wrap to fit, so the box keeps the width dagre
// allocated and neighboring subgraphs stay separated.
//
// This runs from `postinstall` so the fix survives `npm install`. It targets
// the exact call site and fails loudly if mermaid's internals change.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// mermaid ships the same chunk code twice — the ESM build (chunks/mermaid.esm)
// and the core build (chunks/mermaid.core, which dist/mermaid.core.mjs actually
// imports and vite bundles). Patch every copy so the fix applies regardless of
// which entry point is resolved.
const searchDirs = [
  path.join(root, 'node_modules', 'mermaid', 'dist', 'chunks', 'mermaid.esm'),
  path.join(root, 'node_modules', 'mermaid', 'dist', 'chunks', 'mermaid.core'),
  path.join(root, 'node_modules', 'mermaid', 'dist'),
];

// The exact line in mermaid's flowchart subgraph (`rect`) cluster shape:
//   } else {
//     text = await createLabel_default(labelEl, node.label, node.labelStyle || "", false, true);
//   }
// createLabel_default renders the title with an unbounded width. Replace it
// with the same createText call the markdown branch / node labels use, which
// constrains the title to `node.width` and lets it wrap.
const target = 'text = await createLabel_default(labelEl, node.label, node.labelStyle || "", false, true);';
const replacement = `text = await createText(labelEl, node.label, {
      style: node.labelStyle,
      useHtmlLabels,
      isNode: true,
      markdown: false,
      width: node.width
    });`;
// Marker that proves the replacement above is present in a file.
const patchedMarker = 'markdown: false,\n      width: node.width';

let files = [];
for (const dir of searchDirs) {
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.mjs'));
  } catch {
    continue; // dir may not exist (e.g. mermaid layout changed)
  }
  files.push(...names.map((n) => path.join(dir, n)));
}

let foundTarget = false;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(target)) continue;
  foundTarget = true;
  const count = source.split(target).length - 1;
  if (count !== 1) {
    throw new Error(`[patch-mermaid] expected exactly one match in ${file}, found ${count}`);
  }
  writeFileSync(file, source.replace(target, replacement), 'utf8');
  console.log(`[patch-mermaid] patched: ${file}`);
}

if (!foundTarget) {
  const alreadyPatched = files.some((file) => readFileSync(file, 'utf8').includes(patchedMarker));
  if (alreadyPatched) {
    console.log('[patch-mermaid] already patched — nothing to do.');
  } else {
    throw new Error(
      '[patch-mermaid] could not find the mermaid cluster-title call site to patch. ' +
        'mermaid may have been upgraded — review scripts/patch-mermaid.mjs against the new bundle.',
    );
  }
}
