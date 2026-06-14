// Minimal ambient types for js-yaml (no @types installed; we only need load()).
// esbuild bundles the real module at build time — this only satisfies tsc.
declare module 'js-yaml' {
  export function load(input: string): unknown;
}
