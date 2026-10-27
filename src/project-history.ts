import type { Connection } from "./types";
export interface RecentProject {
  id: string;
  connectionId: string;
  endpoint: string;
  hostName: string;
  root: string;
  name: string;
  lastOpened: number;
  pinned: boolean;
  rigId: string;
  rigName: string;
}
export function connectionIdentity(connection: Connection, platform: string) {
  return JSON.stringify([
    connection.id,
    connection.kind,
    connection.host || "",
    connection.port || 22,
    connection.distro || "",
    connection.kind === "local" ? platform : "",
  ]);
}
function pathIdentity(root: string, connection: Connection, platform: string) {
  if (connection.kind === "local" && platform === "win32")
    return root.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  return root.length > 1 ? root.replace(/\/$/, "") : root;
}
export function projectIdentity(
  connection: Connection,
  root: string,
  platform: string,
) {
  return JSON.stringify([
    connectionIdentity(connection, platform),
    pathIdentity(root, connection, platform),
  ]);
}
export function normalizeHistory(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows = value
    .filter((entry): entry is RecentProject => {
      if (!entry || typeof entry !== "object") return false;
      for (const key of [
        "id",
        "connectionId",
        "endpoint",
        "hostName",
        "root",
        "name",
        "rigId",
        "rigName",
      ])
        if (
          typeof entry[key] !== "string" ||
          entry[key].length >
            (["id", "endpoint", "root"].includes(key) ? 10000 : 300)
        )
          return false;
      if (
        !entry.root ||
        entry.root.includes("\0") ||
        !Number.isFinite(entry.lastOpened) ||
        entry.lastOpened < 0 ||
        seen.has(entry.id)
      )
        return false;
      seen.add(entry.id);
      return true;
    })
    .map((entry) => ({
      ...entry,
      pinned: entry.pinned === true,
      lastOpened: Math.min(entry.lastOpened, Date.now()),
    }))
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened,
    )
    .slice(0, 100);
  return [
    ...rows.filter((p) => p.pinned).slice(0, 50),
    ...rows.filter((p) => !p.pinned).slice(0, 50),
  ];
}
export function visitProject(
  history: RecentProject[],
  connection: Connection,
  root: string,
  platform: string,
  rigId = "",
  rigName = "",
): RecentProject[] {
  const id = projectIdentity(connection, root, platform);
  const existing = history.find((p) => p.id === id);
  const entry: RecentProject = {
    id,
    connectionId: connection.id,
    endpoint: connectionIdentity(connection, platform),
    hostName: connection.name,
    root: existing?.root || root,
    name:
      existing?.name ||
      root.replaceAll("\\", "/").replace(/\/$/, "").split("/").pop() ||
      root,
    lastOpened: Date.now(),
    pinned: existing?.pinned || false,
    rigId,
    rigName,
  };
  const rows = [entry, ...history.filter((p) => p.id !== id)];
  return [
    ...rows.filter((p) => p.pinned).slice(0, 50),
    ...rows.filter((p) => !p.pinned).slice(0, 50),
  ];
}
export function availableConnection(
  project: RecentProject,
  connections: Connection[],
  platform: string,
) {
  return connections.find(
    (c) =>
      c.id === project.connectionId &&
      connectionIdentity(c, platform) === project.endpoint,
  );
}
