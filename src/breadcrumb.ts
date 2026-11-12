export interface Crumb { name: string; path: string; last: boolean }

/**
 * Splits a workspace-relative or absolute path into display segments. Pure and
 * display-only: crumbs never navigate or open anything.
 */
export function breadcrumbs(path: string | undefined, maxSegments = 8): { crumbs: Crumb[]; hidden: number } {
  const clean = String(path ?? "").replace(/\\/g, "/").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
  const parts = clean.split("/").filter((p) => p && p !== ".");
  const crumbs: Crumb[] = [];
  let acc = clean.startsWith("/") ? "" : undefined;
  parts.forEach((name, i) => {
    acc = acc === undefined ? name : `${acc}/${name}`;
    crumbs.push({ name, path: acc, last: i === parts.length - 1 });
  });
  const cap = Math.max(2, maxSegments);
  if (crumbs.length <= cap) return { crumbs, hidden: 0 };
  return { crumbs: crumbs.slice(crumbs.length - cap), hidden: crumbs.length - cap };
}
