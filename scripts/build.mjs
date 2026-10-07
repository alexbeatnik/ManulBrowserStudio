// Builds the three halves of the app into dist/.
//
// The main process and the preload script run under Node and are bundled as
// CommonJS, with Electron and the engine binding left as real packages. The
// renderer is a browser bundle: Monaco is ESM that imports its own CSS and
// font, which is exactly what a bundler is for. Monaco's workers are separate
// entry points because a worker is a separate program.
//
// Types are not checked here — `npm run typecheck` does that.

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const dist = 'dist';
const monaco = 'node_modules/monaco-editor/esm/vs';
const production = process.argv.includes('--production');

await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/renderer`, { recursive: true });

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'warning',
};

await build({
  ...common,
  entryPoints: { main: 'src/main/main.ts', preload: 'src/preload/preload.ts' },
  outdir: dist,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // The binding is ESM and is imported at run time; Electron is the host.
  external: ['electron', 'manul-browser'],
});

await build({
  ...common,
  entryPoints: { renderer: 'src/renderer/app.ts' },
  outdir: `${dist}/renderer`,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  loader: { '.ttf': 'file' },
});

await build({
  ...common,
  entryPoints: {
    'editor.worker': `${monaco}/editor/editor.worker.js`,
    'json.worker': `${monaco}/language/json/json.worker.js`,
    'css.worker': `${monaco}/language/css/css.worker.js`,
    'html.worker': `${monaco}/language/html/html.worker.js`,
    'ts.worker': `${monaco}/language/typescript/ts.worker.js`,
  },
  outdir: `${dist}/renderer`,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
});

await cp('src/renderer/index.html', `${dist}/renderer/index.html`);
