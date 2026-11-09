const fmt = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** Warning shown when an editable file is at or above the chosen threshold; "" otherwise. */
export function largeFileNotice(bytes: number, thresholdKb: unknown): string {
  const limit = typeof thresholdKb === "number" && Number.isFinite(thresholdKb) ? thresholdKb * 1024 : Infinity;
  if (!Number.isFinite(bytes) || bytes < limit) return "";
  return `Large file (${fmt(bytes)}). Editing may be slow. Files over 2 MB open as a read-only preview instead. Change the warning size in Settings > Editor.`;
}

/** Errors from the edit read that mean "cannot be opened for editing" and have a safe read-only preview. */
export const PREVIEWABLE_READ_ERROR = /^(Binary files cannot be edited|File exceeds 2 MB)/i;
