// Read-only view of what a needs-input seat is showing. Uses `rig capture`
// (reads the terminal screen; never sends input) and bounds/cleans the text.
const MAX_LINES = 40;
const MAX_CHARS = 8000;

/** Strip terminal escapes and control characters; keep the last lines, bounded. */
function cleanTerminalText(raw, { maxLines = MAX_LINES, maxChars = MAX_CHARS } = {}) {
  let text = String(raw ?? "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  let lines = text.split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  let truncated = false;
  if (lines.length > maxLines) {
    lines = lines.slice(-maxLines);
    truncated = true;
  }
  text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(-maxChars);
    truncated = true;
  }
  return { text, truncated };
}

const cleanPromptText = (raw) => cleanTerminalText(raw);

function createSeatPrompt({ inventory, runRig, now = Date.now }) {
  async function read(connection, id) {
    if (typeof id !== "string" || !id)
      throw Error("Choose a session first.");
    const seat = (await inventory(connection)).seats.find((s) => s.id === id);
    if (
      !seat ||
      !seat.session ||
      seat.session.startsWith("-") ||
      /[\r\n\0]/.test(seat.session)
    )
      throw Error(
        "This session is no longer available. Refresh and select it again.",
      );
    if (seat.status !== "attention")
      throw Error("This session is not waiting for input right now.");
    const output = await runRig(connection, [
      "capture",
      seat.session,
      "--lines",
      String(MAX_LINES),
    ]);
    const { text, truncated } = cleanPromptText(output);
    return {
      seatName: seat.name,
      text,
      truncated,
      capturedAt: new Date(now()).toISOString(),
    };
  }
  return { read };
}
module.exports = { cleanTerminalText, cleanPromptText, createSeatPrompt, MAX_LINES, MAX_CHARS };
