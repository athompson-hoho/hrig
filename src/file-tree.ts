import type { Connection, FileEntry } from "./types";

export function fileTreeOwner(connection: Connection, root: string): string {
  return JSON.stringify([connection.id, connection.kind, connection.host, connection.port,
    connection.distro, connection.rigBinary, root]);
}

export function normalizeFileQuery(value: string): string | null {
  return value.length <= 300 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
}

// Listing identity is separate from opening authority. A POSIX backslash or
// colon is a literal name character; NUL and traversal are never valid identity.
function displayParts(path: string): boolean {
  return typeof path === "string" && !!path && !path.includes("\0") &&
    path.split("/").every(part => !!part && part !== "." && part !== "..");
}
function safeParts(path: string, windows = false): boolean {
  return displayParts(path) && !/[\x00-\x1f\x7f]/.test(path) && (!windows || !/[\\:]/.test(path));
}

export function resolveRevealPath(connection: Connection, root: string, path: string,
  platform: string): string | null {
  if (typeof path !== "string" || !path) return null;
  const windows = connection.kind === "local" && platform === "win32";
  if (!windows && (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\"))) return null;
  if (windows && (/^[A-Za-z]:/.test(path) || path.startsWith("\\\\") || path.startsWith("//"))) {
    const normalize = (value: string) => value.replaceAll("\\", "/");
    const normalizedRoot = normalize(root);
    const base = normalizedRoot.replace(/\/$/, ""), target = normalize(path);
    const absolute = (value: string) => {
      if (/^[A-Za-z]:\//.test(value)) {
        const tail = value.slice(3).replace(/\/$/, "");
        return !tail || safeParts(tail, true);
      }
      if (!value.startsWith("//")) return false;
      const tail = value.slice(2).replace(/\/$/, "");
      return tail.split("/").length >= 2 && safeParts(tail, true);
    };
    if (!absolute(normalizedRoot) || !absolute(target) ||
      !target.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
    const relative = target.slice(base.length + 1);
    if (!safeParts(relative, true) || base.split("/").some(p => p === "." || p === "..")) return null;
    return relative;
  }
  if (path.startsWith("/")) {
    if (!root.startsWith("/") || root.startsWith("//") || path.startsWith("//")) return null;
    const base = root === "/" ? "" : root.replace(/\/$/, "");
    if (base && !safeParts(base.slice(1))) return null;
    if (!path.startsWith(base + "/")) return null;
    path = path.slice(base.length + 1);
  }
  return safeParts(path, windows) ? path : null;
}

export function compareFileEntries(a: FileEntry, b: FileEntry): number {
  const compare = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  return Number(b.directory) - Number(a.directory) ||
    compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.path, b.path);
}

export function projectFileListing(entries: readonly FileEntry[], parent: string): { files: FileEntry[]; omittedPaths: number } {
  const files: FileEntry[] = [], seen = new Map<string, FileEntry>();
  let omittedPaths = 0;
  for (const entry of entries) {
    if (!entry || !displayParts(entry.path) || typeof entry.directory !== "boolean" ||
      entry.name !== entry.path.split("/").pop() ||
      entry.path.slice(0, entry.path.lastIndexOf("/") + 1) !== (parent ? parent + "/" : "")) {
      omittedPaths++; continue;
    }
    const prior = seen.get(entry.path);
    if (prior) {
      if (prior.directory !== entry.directory || prior.name !== entry.name) omittedPaths++;
      continue;
    }
    seen.set(entry.path, entry);
    if (files.length === 600) { omittedPaths++; continue; }
    files.push(entry);
  }
  return { files: files.sort(compareFileEntries), omittedPaths };
}

export function projectFileMatchResult(entries: readonly FileEntry[]): { files: FileEntry[]; omittedPaths: number } {
  const files = new Map<string, FileEntry>();
  const seen = new Set<string>();
  let omittedPaths = 0;
  for (const entry of entries) {
    if (!entry || entry.directory !== false || !displayParts(entry.path)) { omittedPaths++; continue; }
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    if (files.size === 100) { omittedPaths++; continue; }
    files.set(entry.path, { name: entry.path.split("/").pop()!, path: entry.path, directory: false });
  }
  const all = new Map(files);
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      all.set(ancestor, { name: parts[i - 1], path: ancestor, directory: true });
    }
  }
  const output: FileEntry[] = [];
  const visit = (parent: string) => {
    const children = [...all.values()].filter(e => e.path.slice(0, e.path.lastIndexOf("/") + 1) === parent)
      .sort(compareFileEntries);
    for (const child of children) { output.push(child); if (child.directory) visit(child.path + "/"); }
  };
  visit("");
  return { files: output, omittedPaths };
}
export function projectFileMatches(entries: readonly FileEntry[]): FileEntry[] {
  return projectFileMatchResult(entries).files;
}
