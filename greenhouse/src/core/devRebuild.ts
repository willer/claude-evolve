// Pure locator for the greenhouse *source* dir, given the running executable's
// path. Used by the main process (main/DevRebuilder) to decide whether a
// packaged .app is running from inside its own dev tree — the only case where
// silently re-packaging on source changes makes sense. Electron-free + pure so
// it can be unit-tested in core/.

import * as path from 'node:path';

// Files that `npm run package` needs at the source-dir root. All three must be
// present for a dir to count as the greenhouse source (not merely an ancestor
// that happens to contain one of them).
const MARKERS = ['esbuild.mjs', 'package.sh', path.join('src', 'main', 'main.ts')];

/**
 * Walk up from the running executable to find the greenhouse source dir — the
 * directory we can re-package from. Returns null when the app runs from outside
 * its source tree (a shipped install under /Applications), which disables
 * auto-rebuild.
 *
 * The packaged .app lives at `<src>/release/<mac>/Evolve Greenhouse.app/…`, so
 * the source dir is a few levels up from the exe; an unpackaged `electron .`
 * run has its exe deeper under `<src>/node_modules/electron/…`. Both resolve to
 * `<src>` by climbing until every MARKER is present.
 *
 * @param exePath  absolute path of the running executable (app.getPath('exe'))
 * @param exists   filesystem-exists predicate (injected for testability)
 */
export function resolveDevSourceDir(exePath: string, exists: (p: string) => boolean): string | null {
  let dir = path.dirname(exePath);
  // Bound the climb so a pathological path can't spin forever; a real tree is
  // at most ~7 levels from exe to source dir.
  for (let i = 0; i < 12; i++) {
    if (MARKERS.every((m) => exists(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return null;
}
