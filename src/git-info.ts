export type GitInfoSnapshot = {
  state: "repository" | "not-repository" | "unavailable" | "checking";
  root?: string;
  reason?: "unsupported-git";
  head?: "attached" | "detached" | "unborn";
  branch?: string;
  oid?: string;
  comparison?: "known" | "none" | "unknown";
  upstream?: string;
  ahead?: number;
  behind?: number;
};
const label = (v: unknown): v is string => typeof v === "string" && !!v && !/[\x00-\x1f\x7f]/.test(v);
const oid = (v: unknown) => typeof v === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
export function projectGitInfo(value: unknown): GitInfoSnapshot {
  const bad: GitInfoSnapshot = { state: "unavailable" };
  if (!value || typeof value !== "object") return bad;
  const v = value as GitInfoSnapshot;
  if (!label(v.root)) return bad;
  const absent = (...keys: (keyof GitInfoSnapshot)[]) => keys.every(k => v[k] === undefined);
  if (v.state === "unavailable") return v.reason === "unsupported-git" && absent("head", "branch", "oid", "comparison", "upstream", "ahead", "behind")
    ? { state: "unavailable", root: v.root, reason: "unsupported-git" } : bad;
  if (v.reason !== undefined) return bad;
  if (v.state === "not-repository") return absent("head", "branch", "oid", "comparison", "upstream", "ahead", "behind") ? { state: v.state, root: v.root } : bad;
  if (v.state !== "repository") return bad;
  if (v.head === "detached") {
    if (!oid(v.oid) || !absent("branch", "upstream", "ahead", "behind") || v.comparison !== "none") return bad;
  } else if (v.head === "unborn") {
    if (!label(v.branch) || !absent("oid", "upstream", "ahead", "behind") || v.comparison !== "none") return bad;
  } else if (v.head === "attached") {
    if (!label(v.branch) || !oid(v.oid)) return bad;
    if (v.comparison === "known") {
      if (!label(v.upstream) || ![v.ahead, v.behind].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) return bad;
    } else if (v.comparison === "none") {
      if (!absent("upstream", "ahead", "behind")) return bad;
    } else if (v.comparison === "unknown") {
      if (!absent("ahead", "behind") || (v.upstream !== undefined && !label(v.upstream))) return bad;
    } else return bad;
  } else return bad;
  return { ...v };
}
export function describeGitInfo(v: GitInfoSnapshot): { summary: string; detail: string } {
  const refresh = "Open Files and use Refresh files to check again.";
  let summary: string, meaning: string;
  if (v.state === "checking") { summary = "Checking Git…"; meaning = "Checking Git information for the selected workspace."; }
  else if (v.state === "unavailable") {
    summary = v.reason === "unsupported-git" ? "Git unsupported" : "Git unavailable";
    meaning = `${v.reason === "unsupported-git" ? "Git on this host does not support the required metadata commands." : "Git information is unavailable."} ${refresh}`;
  }
  else if (v.state === "not-repository") { summary = "No Git repository"; meaning = "This workspace is not in a Git repository."; }
  else {
    if (v.head === "detached") { summary = "Detached HEAD"; meaning = "Detached HEAD; no branch is checked out. Ahead and behind counts are unavailable."; }
    else if (v.head === "unborn") { summary = `${v.branch} · no commits`; meaning = `Branch ${v.branch} has no commits. Ahead and behind counts are unavailable.`; }
    else if (v.comparison === "known") {
      const commits = (n: number) => `${n} ${n === 1 ? "commit" : "commits"}`;
      summary = `${v.branch} ↑${v.ahead} ↓${v.behind}`;
      meaning = `Branch ${v.branch}. Upstream ${v.upstream}. ${commits(v.ahead!)} ahead and ${commits(v.behind!)} behind ${v.upstream}.`;
    } else if (v.comparison === "none") { summary = `${v.branch} · no upstream`; meaning = `Branch ${v.branch}. No upstream is configured; ahead and behind counts are unavailable.`; }
    else { summary = `${v.branch} · comparison unavailable`; meaning = `Branch ${v.branch}. ${v.upstream ? `Upstream ${v.upstream}. ` : ""}Ahead and behind counts are unavailable from local Git information.`; }
    meaning += ` Local Git snapshot; no remote fetch. ${refresh}`;
  }
  if (v.state !== "checking") meaning += " Snapshot, not live. Terminal checkouts or commits need Refresh files.";
  return { summary, detail: `Open source control. ${meaning}` };
}
