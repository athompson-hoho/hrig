import { useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import type { Connection } from "./types";
import { fileTreeOwner } from "./file-tree";
import { describeGitInfo, projectGitInfo, type GitInfoSnapshot } from "./git-info";

export default function GitInfoStatus({ connection, root, revision, onOpen }: {
  connection: Connection; root: string; revision: number; onOpen: () => void;
}) {
  const key = JSON.stringify([fileTreeOwner(connection, root), revision]);
  const lifetime = useRef({ key, active: true });
  if (lifetime.current.key !== key) {
    lifetime.current.active = false;
    lifetime.current = { key, active: true };
  }
  const generation = lifetime.current;
  const [result, setResult] = useState<{ generation: typeof generation; snapshot: GitInfoSnapshot } | null>(null);
  useEffect(() => {
    generation.active = true;
    const publish = (snapshot: GitInfoSnapshot) => {
      if (generation.active && lifetime.current === generation) setResult({ generation, snapshot });
    };
    Promise.resolve().then(() => window.hrig.file(connection, { op: "gitInfo", root }))
      .then(value => publish(projectGitInfo(value)), () => publish({ state: "unavailable" }));
    return () => { generation.active = false; };
  }, [generation]);
  const copy = describeGitInfo(result?.generation === generation ? result.snapshot : { state: "checking" });
  return <button type="button" className="git-info-status" onClick={onOpen} aria-label={copy.detail} title={copy.detail}>
    <GitBranch size={11} aria-hidden="true" /><span className="git-info-summary">{copy.summary}</span>
  </button>;
}
