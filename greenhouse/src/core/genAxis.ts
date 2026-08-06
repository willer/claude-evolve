// Shared X domain for the per-generation charts. Pure — the renderer draws with it.
//
// The detail view stacks two charts that both read "by generation": the best-score
// sparkline and the year-returns multi-line. Each one plots only the generations IT can
// (a gen with no completed candidate has no score; a gen with no return_YYYY row has no
// year point), so their point counts differ. Positioning points by ARRAY INDEX therefore
// stretched each chart's own subset across the same pixel width and the two x-axes
// disagreed — gen 500 sat at 40% in one panel and 92% in the other, which made the year
// lines look squashed or absent rather than merely sparse.
//
// Fix: both charts position by real generation number over ONE domain — min of the two
// mins, max of the two maxes — so a vertical line through both panels is the same gen.

/** Inclusive generation span shared by every chart drawn from it. */
export interface GenAxis {
  min: number;
  max: number;
}

/** Union span of several generation lists: min(min…), max(max…).
 *  Empty lists are ignored; null when nothing is plottable at all. */
export function sharedGenDomain(lists: number[][]): GenAxis | null {
  const all = lists.flat();
  if (all.length === 0) return null;
  return { min: Math.min(...all), max: Math.max(...all) };
}

/** Position of `gen` in the domain as a 0..1 fraction of the plot width.
 *  A zero-width domain (one generation) collapses to 0 rather than dividing by zero. */
export function genFrac(gen: number, ax: GenAxis): number {
  const span = ax.max - ax.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (gen - ax.min) / span));
}

/** 0..1 positions for one chart's points on the shared domain — the mapping the renderer
 *  hands to each chart. Two charts covering different generation subsets get the SAME
 *  fraction for a generation they share, which index-based positioning could not do. */
export function chartFracs(gens: number[], ax: GenAxis): number[] {
  return gens.map((g) => genFrac(g, ax));
}

/** Evenly spaced generation labels across the domain, as [gen, fraction] pairs.
 *  `count` is the label budget; the endpoints are always included and labels are whole
 *  generations. Both charts call this with the same domain, so their ticks match. */
export function genTicks(ax: GenAxis, count: number): Array<[number, number]> {
  const n = Math.max(2, count);
  if (ax.max - ax.min <= 0) return [[ax.min, 0]];
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);
    out.push([Math.round(ax.min + (ax.max - ax.min) * f), f]);
  }
  return out;
}
