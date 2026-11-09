import type { PanelConfig } from "./types";

// Presence is part of identity: absent, undefined, null and empty are distinct.
function field(object: object, key: string) {
  const value = (object as Record<string, unknown>)[key];
  return [Object.prototype.hasOwnProperty.call(object, key), typeof value, value];
}
export function editorChangeOwner(id: string, config: PanelConfig, diff = false) {
  return JSON.stringify([
    id, diff,
    ...["id", "kind", "host", "port", "distro", "rigBinary", "root"].map(
      key => field(config.connection, key),
    ),
    field(config, "root"), field(config, "path"),
  ]);
}

export interface EditorChangeCapture {
  owner: string;
  lifetime: object;
  buffer: object | undefined;
  request: number;
  edit: number;
  content: string | undefined;
  saved: string | undefined;
  revision: string | undefined;
}
export function canPublishEditorChange(
  captured: EditorChangeCapture,
  current: EditorChangeCapture,
  preserveEdits = true,
) {
  return captured.owner === current.owner &&
    captured.lifetime === current.lifetime &&
    captured.buffer === current.buffer &&
    captured.request === current.request &&
    captured.saved === current.saved &&
    captured.revision === current.revision &&
    (!preserveEdits || (captured.edit === current.edit && captured.content === current.content));
}

export function canAcknowledgeEditorChange(
  observedRevision: string,
  representedRevision: string | undefined,
  busy: boolean,
) {
  return !busy && observedRevision === representedRevision;
}
