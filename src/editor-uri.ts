import type { PanelConfig } from "./types";
// Keep the host/project in opaque path segments. Raw Unix roots introduce a
// second slash and TS canonicalization then disagrees with Monaco's model key.
export function editorModelPath(config: PanelConfig) {
  const c = config.connection;
  const scope = JSON.stringify([
    c.id,
    c.kind,
    c.host || "",
    c.port || "",
    c.distro || "",
  ]);
  const relative = (config.path || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return `/hrig/${encodeURIComponent(scope)}/${encodeURIComponent(config.root)}/${relative}`;
}
