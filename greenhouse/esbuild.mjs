import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'error' };

await build({
  ...common,
  entryPoints: ['src/main/main.ts'],
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'node-pty'],
  outfile: 'dist/main/main.js',
});

await build({
  ...common,
  entryPoints: ['src/preload.ts'],
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: 'dist/preload.js',
});

await build({
  ...common,
  entryPoints: ['src/renderer/renderer.ts'],
  platform: 'browser',
  format: 'iife',
  outfile: 'dist/renderer/renderer.js',
});

mkdirSync('dist/renderer', { recursive: true });
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('node_modules/@xterm/xterm/css/xterm.css', 'dist/renderer/xterm.css');
