// Keep edit buffers outside docked component lifetimes so rearranging panels
// never loses unsaved text. These buffers are intentionally not written to disk.
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
}
