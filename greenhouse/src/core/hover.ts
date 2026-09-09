// Hover readout geometry for the enlarged (zoomed) charts. Pure — the renderer
// draws with it.
//
// The zoom overlay used to be a bigger repaint of the same static SVG: the axis
// gutter told you the min/max and nothing else, so reading "what was the score at
// generation 340" meant eyeballing a pixel against a tick. Every zoomable chart now
// serialises its plotted points into the SVG as hover COLUMNS — one per x position,
// carrying every series' value at that x — and the overlay hit-tests the pointer
// against them to draw a crosshair and an exact-value tooltip.
//
// Columns rather than points: the year-returns chart draws one line per return_YYYY
// column, and a reader hovering a generation wants ALL of that generation's years at
// once, not whichever single line happens to be nearest the cursor. Hit-testing is
// therefore x-only, which also means a pointer anywhere in the plot's height finds a
// readout instead of requiring the user to trace a thin line.

/** One series' value inside a hover column. `y` is its pixel row, so the overlay can
 *  put a dot on the line it came from. */
export interface HoverRow {
  label: string;
  value: string;
  /** CSS colour of the series (as drawn), or undefined for an unstyled readout. */
  color?: string;
  y: number;
}

/** Everything plotted at one x pixel position. `title` names the x itself
 *  ("gen 340", "2024-03-15"). */
export interface HoverColumn {
  x: number;
  title: string;
  rows: HoverRow[];
}

/** Index of the column nearest `mx`, or -1 when there are none.
 *  `xs` must be ascending (every chart emits its columns in plot order), which lets
 *  this binary-search: a daily NAV curve is thousands of columns and this runs on
 *  every mousemove. */
export function nearestColumnIndex(xs: number[], mx: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < mx) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first column at or past mx; its left neighbour may be closer.
  if (lo > 0 && Math.abs(xs[lo - 1] - mx) <= Math.abs(xs[lo] - mx)) return lo - 1;
  return lo;
}

/** Top-left corner for a tooltip of `tipW`×`tipH` anchored at (px, py) inside a
 *  `boxW`×`boxH` plot: above-right of the cursor by default, flipped to the other
 *  side of either axis when that would overflow, and clamped as a last resort so a
 *  tooltip wider or taller than the plot still starts on screen. */
export function tipPlacement(
  px: number,
  py: number,
  tipW: number,
  tipH: number,
  boxW: number,
  boxH: number,
  pad = 12,
): { left: number; top: number } {
  let left = px + pad;
  if (left + tipW > boxW) left = px - pad - tipW;
  left = Math.max(0, Math.min(left, Math.max(0, boxW - tipW)));
  let top = py - pad - tipH;
  if (top < 0) top = py + pad;
  top = Math.max(0, Math.min(top, Math.max(0, boxH - tipH)));
  return { left, top };
}
