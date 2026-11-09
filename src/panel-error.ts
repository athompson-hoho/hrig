const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** A short, plain-text description of a render error, safe to display and copy. */
export function describePanelError(error: unknown, max = 600): string {
  let text = "";
  try {
    if (error instanceof Error) text = `${error.name}: ${error.message}`;
    else if (typeof error === "string") text = error;
    else text = "Unknown error";
  } catch {
    text = "Unknown error";
  }
  text = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text || "Unknown error";
}
