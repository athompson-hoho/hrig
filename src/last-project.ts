import type { Connection } from "./types";
import {
  availableConnection,
  normalizeHistory,
  projectIdentity,
  type RecentProject,
} from "./project-history";

/** Why launch opens a project or does not: the setting is not on, there is no project to open, the project launch brought back is the most recent one, the most recent one is on another connection, or it is opened. */
export type RestoreReason =
  "off" | "no-project" | "already-open" | "other-connection" | "open";

/** The answer of planLastProject: the project to open, only when the reason is "open", and the reason. */
export interface RestorePlan {
  reason: RestoreReason;
  project: RecentProject | null;
}

/** What planLastProject reads: the setting, the saved history and connections, the platform, and the connection and folder launch brought back. */
export interface RestoreInput {
  enabled?: unknown;
  history?: unknown;
  connections?: unknown;
  platform?: unknown;
  active?: { connection?: unknown; root?: unknown } | null;
}

function isConnection(value: unknown): value is Connection {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Connection).id === "string" &&
    typeof (value as Connection).kind === "string"
  );
}

function usable(connections: unknown): Connection[] {
  return Array.isArray(connections) ? connections.filter(isConnection) : [];
}

function platformOf(platform: unknown): string {
  return typeof platform === "string" && platform ? platform : "unknown";
}

/** The most recently opened project of the history whose saved connection is still available and unchanged, or null. Pinning does not matter: the newest lastOpened wins, a pinned project wins a tie, and after that the earlier entry does. Malformed history entries and connections are ignored, and nothing is changed. */
export function pickLastProject(
  history: unknown,
  connections: unknown,
  platform: unknown,
): RecentProject | null {
  const list = usable(connections);
  const os = platformOf(platform);
  let best: RecentProject | null = null;
  for (const project of normalizeHistory(history))
    if (
      availableConnection(project, list, os) &&
      (best === null || project.lastOpened > best.lastOpened)
    )
      best = project;
  return best;
}

/** What launch should do once the workspace has loaded. Nothing unless enabled is exactly true. Otherwise the project to open is pickLastProject, left alone when launch already brought it back (the same connection and folder), and left alone when its connection is neither this computer nor the connection already in use, so that launch never reaches a host it would not reach anyway. The answer says why, and holds the project only for "open". */
export function planLastProject(input?: RestoreInput | null): RestorePlan {
  if (!input || typeof input !== "object" || input.enabled !== true)
    return { reason: "off", project: null };
  const list = usable(input.connections);
  const os = platformOf(input.platform);
  const project = pickLastProject(input.history, list, os);
  if (!project) return { reason: "no-project", project: null };
  const active = input.active;
  const connection =
    active && isConnection(active.connection) ? active.connection : null;
  const root = typeof active?.root === "string" ? active.root : "";
  if (
    connection &&
    root &&
    projectIdentity(connection, root, os) === project.id
  )
    return { reason: "already-open", project: null };
  const target = availableConnection(project, list, os);
  if (!target || (target.kind !== "local" && target.id !== connection?.id))
    return { reason: "other-connection", project: null };
  return { reason: "open", project };
}
