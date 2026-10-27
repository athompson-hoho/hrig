// Keep edit buffers outside docked component lifetimes so rearranging panels
// never loses unsaved text. Dirty buffers also have bounded local recovery copies.
import type { PanelConfig } from "./types";
import { draftKey, draftOperation } from "./drafts";
export const bufferConfigs = new Map<string, PanelConfig>();
export const editorFocusers = new Map<string, () => void>();
export function persistBuffer(id: string) {
  const b = buffers.get(id),
    c = bufferConfigs.get(id);
  if (!b || !c) return;
  const key = draftKey("editor", c.connection, c.root, c.path);
  if (b.content === b.saved) draftOperation("delete", key);
  else draftOperation("put", key, { kind: "editor", config: c, data: b });
}
export const buffers = new Map<
  string,
  { content: string; saved: string; revision: string }
>();
export const problems = new Map<
  string,
  {
    path: string;
    line: number;
    message: string;
    severity: number;
    connection: import("./types").Connection;
    root: string;
  }[]
>();
export function getDirtyBuffers() {
  return [...buffers].filter(([, buffer]) => buffer.content !== buffer.saved);
}
export function clearBuffer(id: string) {
  const c = bufferConfigs.get(id);
  if (c)
    draftOperation("delete", draftKey("editor", c.connection, c.root, c.path));
  bufferConfigs.delete(id);
  buffers.delete(id);
  problems.delete(id);
  window.dispatchEvent(new Event("hrig:problems"));
}
export function bufferText(id: string) {
  return buffers.get(id)?.content;
}
export function markSaved(id: string) {
  const buffer = buffers.get(id);
  if (buffer) buffer.saved = buffer.content;
  persistBuffer(id);
}
