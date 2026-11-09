import type { Connection, FileEntry } from "./types";

export function fileTreeOwner(connection: Connection, root: string): string {
  return JSON.stringify([connection.id, connection.kind, connection.host, connection.port,
    connection.distro, connection.rigBinary, root]);
}

export function normalizeFileQuery(value: string): string | null {
  return value.length <= 300 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
}

// Backend containment remains authoritative. Refuse ambiguous lexical inputs here.
function safeParts(path: string): boolean {
  return !!path && !/[\\:\x00-\x1f\x7f]/.test(path) &&
    path.split("/").every(part => !!part && part !== "." && part !== "..");
}

export function resolveRevealPath(connection: Connection, root: string, path: string,
  platform: string): string | null {
  if (typeof path !== "string" || !path) return null;
  const windows = connection.kind === "local" && platform === "win32";
  if (windows && (/^[A-Za-z]:/.test(path) || path.startsWith("\\\\"))) {
    const normalize = (value: string) => value.replaceAll("\\", "/");
    const base = normalize(root).replace(/\/$/, ""), target = normalize(path);
    const absolute = (value: string) => /^[A-Za-z]:\//.test(value) || /^\/\/[^/]+\/[^/]+\//.test(value + "/");
    if (!absolute(base) || !absolute(target) ||
      !target.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
    const relative = target.slice(base.length + 1);
    if (!safeParts(relative) || base.split("/").some(p => p === "." || p === "..")) return null;
    return relative;
  }
  if (path.startsWith("/")) {
    if (!root.startsWith("/") || root.startsWith("//") || path.startsWith("//")) return null;
    const base = root === "/" ? "" : root.replace(/\/$/, "");
    if (base && !safeParts(base.slice(1))) return null;
    if (!path.startsWith(base + "/")) return null;
    path = path.slice(base.length + 1);
  }
  return safeParts(path) ? path : null;
}

export function compareFileEntries(a: FileEntry, b: FileEntry): number {
  const compare = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  return Number(b.directory) - Number(a.directory) ||
    compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.path, b.path);
}

export function projectFileMatches(entries: readonly FileEntry[]): FileEntry[] {
  const files = new Map<string, FileEntry>();
  for (const entry of entries) {
    if (entry.directory || !safeParts(entry.path) || files.has(entry.path)) continue;
    if (files.size === 100) break;
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
  return output;
}
