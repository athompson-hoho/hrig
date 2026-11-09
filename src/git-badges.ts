export type GitLetter = "M" | "A" | "D" | "?";
export type GitRecord = { path: string; status: string; letter: GitLetter; description: string; directory: boolean; covering: boolean };
export type GitSnapshot = { state: "ready"; records: GitRecord[]; omittedPaths?: number } | { state: "unavailable" | "not-repository" };
const conflicts: Record<string, string> = { DD: "both deleted", AU: "added by us", UD: "deleted by them", UA: "added by them", DU: "deleted by us", AA: "both added", UU: "both modified" };
const meanings: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed; destination only", C: "Copied; destination only", T: "Type changed" };
const safe = (path: string) => !!path && !/[\\:\x00-\x1f\x7f]/.test(path) && path.split("/").every(p => !!p && p !== "." && p !== "..");
const repoPath = (path: string) => !!path && !path.includes("\0") && path.split("/").every(p => !!p && p !== "." && p !== "..");

// Header/provenance failures invalidate the snapshot; individual refused records
// remain counted partial knowledge, including records outside this project.
export function projectGitStatus(value: unknown): GitSnapshot {
  const bad: GitSnapshot = { state: "unavailable" };
  if (!value || typeof value !== "object") return bad;
  const data = value as Record<string, unknown>;
  if (data.isRepository === false) return { state: "not-repository" };
  if (data.isRepository !== true || typeof data.root !== "string" || !data.root || typeof data.projectPrefix !== "string" || !Array.isArray(data.entries)) return bad;
  const prefix = data.projectPrefix;
  if (prefix && (!prefix.endsWith("/") || !repoPath(prefix.slice(0, -1)))) return bad;
  if (data.omittedPaths !== undefined && (!Number.isSafeInteger(data.omittedPaths) || (data.omittedPaths as number) < 0)) return bad;
  let omittedPaths = (data.omittedPaths as number | undefined) ?? 0;
  const records = new Map<string, GitRecord>();
  const seen = new Map<string, { status: string; count: number; conflict: boolean }>();
  for (const entry of data.entries) {
    if (!entry || typeof entry.path !== "string" || typeof entry.status !== "string") { omittedPaths++; continue; }
    const { path, status } = entry;
    const directory = path.endsWith("/");
    if (!repoPath(directory ? path.slice(0, -1) : path) || (directory && status !== "??")) { omittedPaths++; continue; }
    const covering = directory && !!prefix && prefix.startsWith(path);
    const projected = covering ? path : path.startsWith(prefix) ? path.slice(prefix.length) : path;
    if (!covering && !safe(directory ? projected.slice(0, -1) : projected)) { omittedPaths++; continue; }
    const conflict = Object.hasOwn(conflicts, status) ? conflicts[status] : undefined;
    if (!(status === "??" || conflict || /^[MADRCT]{1,2}$/.test(status))) { omittedPaths++; continue; }
    const prior = seen.get(path);
    if (prior) {
      if (prior.conflict) omittedPaths++;
      else if (prior.status !== status) {
        omittedPaths += prior.count + 1;
        prior.conflict = true;
        records.delete(path);
      }
      prior.count++;
      continue;
    }
    seen.set(path, { status, count: 1, conflict: false });
    if (!path.startsWith(prefix) && !covering) continue;
    if (!projected && !covering) { omittedPaths++; continue; }
    const letter: GitLetter = conflict ? "M" : status === "??" ? "?" : status.includes("D") ? "D" : status.includes("A") ? "A" : "M";
    const description = conflict ? `Conflict: ${conflict}` : status === "??" ? directory ? "Untracked directory; contents not individually reported" : "Untracked" : [...status].map(c => meanings[c]).join("; ");
    records.set(path, { path: projected, status, letter, description, directory, covering });
  }
  if (!Number.isSafeInteger(omittedPaths)) return bad;
  return { state: "ready", records: [...records.values()], ...(omittedPaths ? { omittedPaths } : {}) };
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
