const crypto = require("node:crypto");
function createSessionRelaunch({
  inventory,
  runRig,
  parseJson,
  now = Date.now,
}) {
  const previews = new Map(),
    running = new Set();
  const keyFor = (connection, id) => JSON.stringify([connection, id]);
  const target = async (connection, id) => {
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
    return seat;
  };
  const plan = async (connection, seat) => {
    const help = await runRig(connection, ["seat", "launch", "--help"]);
    for (const flag of ["--fresh", "--stop", "--plan", "--reason", "--json"])
      if (!help.includes(flag))
        throw Error(
          "This OpenRig version cannot relaunch sessions. Update OpenRig on this host.",
        );
    const result = parseJson(
      await runRig(connection, [
        "seat",
        "launch",
        seat.session,
        "--fresh",
        "--stop",
        "--plan",
        "--json",
      ]),
    );
    if (result.complete !== true || result.launchable !== true)
      throw Error(
        (result.blockers || [])
          .map((b) => b.message)
          .filter(Boolean)
          .join(" ") ||
          "OpenRig could not confirm that this session can be relaunched.",
      );
    return result;
  };
  return async (connection, a) => {
    if (typeof a.id !== "string" || !a.id)
      throw Error("Select a session to relaunch.");
    const key = keyFor(connection, a.id);
    if (running.has(key))
      throw Error("This session is already being relaunched.");
    for (const [token, receipt] of previews)
      if (now() - receipt.at > 300000) previews.delete(token);
    if (a.op === "relaunchPlan") {
      const seat = await target(connection, a.id),
        result = await plan(connection, seat);
      for (const [token, receipt] of previews)
        if (receipt.key === key) previews.delete(token);
      const token = crypto.randomUUID();
      previews.set(token, {
        key,
        session: seat.session,
        name: seat.name,
        at: now(),
      });
      return { token, plan: result };
    }
    const receipt = previews.get(a.token);
    if (!receipt || receipt.key !== key)
      throw Error("Review this session again before relaunching.");
    if (a.confirmation !== receipt.name)
      throw Error("Type the session name to confirm a fresh relaunch.");
    if (
      typeof a.reason !== "string" ||
      !a.reason.trim() ||
      a.reason.length > 1000 ||
      a.reason.includes("\0")
    )
      throw Error("Enter a relaunch reason under 1,000 characters.");
    previews.delete(a.token);
    running.add(key);
    try {
      const seat = await target(connection, a.id);
      if (seat.session !== receipt.session)
        throw Error("The session changed. Review it again before relaunching.");
      await plan(connection, seat);
      const result = parseJson(
        await runRig(
          connection,
          [
            "seat",
            "launch",
            seat.session,
            "--fresh",
            "--stop",
            "--reason",
            a.reason.trim(),
            "--json",
          ],
          180000,
        ),
      );
      if (result.ok === false)
        throw Error(
          result.message ||
            "OpenRig did not complete the relaunch. Inspect the session before retrying.",
        );
      return result;
    } finally {
      running.delete(key);
    }
  };
}
module.exports = { createSessionRelaunch };
