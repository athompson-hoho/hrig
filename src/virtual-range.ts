export type VirtualRange = Readonly<{ start: number; end: number; visibleStart: number; visibleEnd: number; scrollTop: number }>;

const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

/** Natural row extents, including spacing; never changes the source sizes. */
export function prefixOffsets(sizes: readonly number[], estimate = 55): number[] {
  const fallback = positive(estimate, 55);
  const offsets = [0];
  for (const size of sizes) offsets.push(Math.min(Number.MAX_SAFE_INTEGER, offsets[offsets.length - 1] + positive(size, fallback)));
  return offsets;
}

/** End-exclusive intersection with four rows of overscan on each side. */
export function viewportRange(offsets: readonly number[], scrollTop: number, height: number, overscan = 4): VirtualRange {
  const count = Math.max(0, offsets.length - 1);
  const extent = Number.isFinite(height) && height > 0 ? height : 0;
  const top = Math.min(Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0), Math.max(0, (offsets[count] || 0) - extent));
  if (!count) return { start: 0, end: 0, visibleStart: 0, visibleEnd: 0, scrollTop: 0 };
  let first = 0;
  while (first < count - 1 && offsets[first + 1] <= top) first++;
  let end = first + 1;
  while (extent > 0 && end < count && offsets[end] < top + extent) end++;
  const extra = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 4;
  return { start: Math.max(0, first - extra), end: Math.min(count, end + extra), visibleStart: first, visibleEnd: end, scrollTop: top };
}

/** Retention adds isolated rows, never the intervening range. */
export function sparseRetainedIndices(range: VirtualRange, focused = -1, dragged = -1, count = range.end): number[] {
  const indices = new Set<number>();
  for (let i = range.start; i < range.end; i++) indices.add(i);
  for (const i of [focused, dragged]) if (Number.isInteger(i) && i >= 0 && i < count) indices.add(i);
  return [...indices].sort((a, b) => a - b);
}
