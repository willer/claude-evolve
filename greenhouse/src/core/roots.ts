// Multi-root identity: the fleet scans several root directories, and the same
// directory name can appear under more than one (two repos each with `1d-fas/`).
// Everything that identifies a workspace or tool — tmux session names, starred
// prefs, IPC targets, renderer selection — keys off `key`, never the bare name.
//
// AIDEV-NOTE: the FIRST occurrence (in configured roots order) keeps the plain
// name as its key, so a single-root setup (and the trading-strategies TUI's
// shared `evolve-<dir>` session scheme) is unchanged. Only later duplicates get
// `name@label`, where label is the shortest trailing path of the root that
// tells the colliding roots apart. Reordering roots can re-key a duplicate —
// accepted: its old tmux session keeps running, it just isn't adopted.

/** Characters tmux mangles or treats as target separators (`.` `:`), plus
 *  anything shell/tooltip-hostile, collapse to `_`. */
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-]/g, '_');
}

function segments(p: string): string[] {
  return p.split('/').filter(Boolean);
}

/** Shortest trailing path of `root` (segments joined by `-`) that no other root
 *  in `others` shares. Falls back to the full path when one root is a suffix of
 *  another (never in practice — roots are absolute). */
export function rootLabel(root: string, others: string[]): string {
  const segs = segments(root);
  const rest = others.filter((o) => o !== root).map(segments);
  for (let n = 1; n <= segs.length; n++) {
    const tail = segs.slice(-n).join('/');
    if (!rest.some((o) => o.slice(-n).join('/') === tail)) return sanitize(segs.slice(-n).join('-'));
  }
  return sanitize(segs.join('-'));
}

/** Assign each item a fleet-unique `key`. Items arrive in scan order (roots
 *  order, then directory order); the first item with a given name keeps it
 *  as its key, later ones become `name@<root label>`. */
export function assignKeys<T extends { name: string; root: string }>(items: T[]): Array<T & { key: string }> {
  const roots = [...new Set(items.map((i) => i.root))];
  const taken = new Set<string>();
  return items.map((it) => {
    let key = it.name;
    if (taken.has(key)) key = `${it.name}@${rootLabel(it.root, roots)}`;
    taken.add(key);
    return { ...it, key };
  });
}
