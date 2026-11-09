// Read-only tail of a seat's recorded transcript via `rig transcript`.
// Never sends anything to the seat; output is cleaned and bounded.
const { cleanTerminalText } = require("./seat-prompt.cjs");
const TAIL_LINES = 200;
const MAX_LINES = 200;
const MAX_CHARS = 30000;

function createSeatTranscript({ inventory, runRig, now = Date.now }) {
  async function read(connection, id) {
    if (typeof id !== "string" || !id) throw Error("Choose a session first.");
    const seat = (await inventory(connection)).seats.find((s) => s.id === id);
    if (
      !seat ||
      !seat.session ||
      seat.session.startsWith("-") ||
      /[\s\0]/.test(seat.session)
    )
      throw Error("This session is no longer available. Refresh and select it again.");
    const output = await runRig(connection, [
      "transcript",
      seat.session,
      "--tail",
      String(TAIL_LINES),
    ]);
    const { text, truncated } = cleanTerminalText(output, {
      maxLines: MAX_LINES,
      maxChars: MAX_CHARS,
    });
    return {
      seatName: seat.name,
      text,
      truncated,
      capturedAt: new Date(now()).toISOString(),
    };
  }
  return { read };
}
module.exports = { createSeatTranscript, TAIL_LINES, MAX_LINES, MAX_CHARS };
