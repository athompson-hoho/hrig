export type GitLetter = "M" | "A" | "D" | "?";
export type GitRecord = { path: string; status: string; letter: GitLetter; description: string; directory: boolean; covering: boolean };
export type GitSnapshot = { state: "ready"; records: GitRecord[] } | { state: "unavailable" | "not-repository" };
const conflicts: Record<string, string> = { DD: "both deleted", AU: "added by us", UD: "deleted by them", UA: "added by them", DU: "deleted by us", AA: "both added", UU: "both modified" };
const meanings: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed; destination only", C: "Copied; destination only", T: "Type changed" };
const safe = (path: string) => !!path && !/[\\:\x00-\x1f\x7f]/.test(path) && path.split("/").every(p => !!p && p !== "." && p !== "..");

// Validate the whole response before excluding records outside the selected project.
export function projectGitStatus(value: unknown): GitSnapshot {
  const bad: GitSnapshot = { state: "unavailable" };
  if (!value || typeof value !== "object") return bad;
  const data = value as Record<string, unknown>;
  if (data.isRepository === false) return { state: "not-repository" };
  if (data.isRepository !== true || typeof data.root !== "string" || !data.root || typeof data.projectPrefix !== "string" || !Array.isArray(data.entries)) return bad;
  const prefix = data.projectPrefix;
  if (prefix && (!prefix.endsWith("/") || !safe(prefix.slice(0, -1)))) return bad;
  const records: GitRecord[] = [], seen = new Map<string, string>();
  for (const entry of data.entries) {
    if (!entry || typeof entry.path !== "string" || typeof entry.status !== "string") return bad;
    const { path, status } = entry;
    const directory = path.endsWith("/");
    if (!safe(directory ? path.slice(0, -1) : path) || (directory && status !== "??")) return bad;
    const conflict = Object.hasOwn(conflicts, status) ? conflicts[status] : undefined;
    if (!(status === "??" || conflict || /^[MADRCT]{1,2}$/.test(status))) return bad;
    if (seen.has(path)) { if (seen.get(path) !== status) return bad; continue; }
    seen.set(path, status);
    const covering = directory && !!prefix && prefix.startsWith(path);
    if (!path.startsWith(prefix) && !covering) continue;
    const projected = covering ? path : path.slice(prefix.length);
    if (!projected && !covering) return bad;
    const letter: GitLetter = conflict ? "M" : status === "??" ? "?" : status.includes("D") ? "D" : status.includes("A") ? "A" : "M";
    const description = conflict ? `Conflict: ${conflict}` : status === "??" ? directory ? "Untracked directory; contents not individually reported" : "Untracked" : [...status].map(c => meanings[c]).join("; ");
    records.push({ path: projected, status, letter, description, directory, covering });
  }
  return { state: "ready", records };
}

export function gitCounts(records: readonly GitRecord[]): { letter: GitLetter; count: number }[] {
  return (["M", "A", "D", "?"] as GitLetter[]).map(letter => ({ letter, count: records.filter(r => r.letter === letter).length })).filter(r => r.count);
}
export function gitRowRecords(records: readonly GitRecord[], path: string, directory: boolean): GitRecord[] {
  return records.filter(r => !r.covering && (r.path === path || (directory && (r.path === path + "/" || r.path.startsWith(path + "/")))));
}
export function gitRecordText(record: GitRecord): string {
  if (record.covering) return `Reported untracked ancestor directory: ${record.path}. Covers this project; individual file statuses are not reported.`;
  return `${record.path} — ${record.description} (Git code: ${record.status}).${record.description === "Deleted" ? " Reported path; no file-open action." : ""}`;
}
