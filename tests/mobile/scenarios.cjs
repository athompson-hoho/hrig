// Shared browser/native fixture. No command reaches a live rig.
function mobileScenario() {
  const state = {
    rich: false,
    queueFailure: false,
    inventoryFailure: false,
    screenFailure: false,
    messageFailure: false,
    empty: false,
    sessionRevision: 1,
    removeSeat: false,
  };
  const receipts = [];
  const fault = () => {
    throw new Error("Fixture SSH host is unreachable.");
  };
  const connections = async () =>
    state.rich
      ? [
          {
            id: "offline",
            name: "Unreachable SSH (first saved)",
            kind: "ssh",
            host: "fixture.invalid",
          },
          {
            id: "fixture",
            name: "Ubuntu active desktop connection",
            kind: "wsl",
            distro: "Fixture",
          },
        ]
      : [
          {
            id: "fixture",
            name: "Secure pairing fixture",
            kind: "wsl",
            distro: "Fixture",
          },
        ];
  const inventory = async (connection) => {
    if (connection.id === "offline") return fault();
    if (state.inventoryFailure)
      throw new Error("Fixture inventory request failed.");
    if (state.empty)
      return { rigs: [], seats: [], sampledAt: new Date().toISOString() };
    const rigs = state.rich
      ? [
          {
            id: "rig",
            name: "Secure test rig",
            status: "running",
            nodeCount: 6,
          },
          {
            id: "long",
            name: "A research rig with a long name that must wrap on a narrow phone",
            status: "running",
            nodeCount: 5,
          },
        ]
      : [
          {
            id: "rig",
            name: "Secure test rig",
            status: "running",
            nodeCount: 1,
          },
        ];
    const seats = Array.from({ length: state.rich ? 12 : 1 }, (_, index) => ({
      id: index === 0 ? "seat" : `seat-${index}`,
      rigId: index < 6 ? "rig" : index < 11 ? "long" : "unlisted",
      rigName:
        index < 6
          ? "Secure test rig"
          : index < 11
            ? rigs[1].name
            : "Recovered sessions",
      name: index === 0 ? "builder" : `agent-${index}`,
      runtime: index % 2 ? "claude" : "codex",
      model: state.rich ? `model-${index}-with-a-descriptive-name` : "",
      pod: "pod-" + index,
      status: index === 3 ? "stopped" : index === 5 ? "attention" : "working",
      session:
        index === 3 ? null : `fixture-${index}-v${state.sessionRevision}`,
      activity: state.rich
        ? "Reviewing work with enough activity text to wrap without hiding the information."
        : "",
      error:
        index === 5 ? "Agent needs a user decision before proceeding." : "",
      workCount: index + 1,
    }));
    return {
      rigs,
      seats: state.removeSeat ? seats.filter((s) => s.id !== "seat") : seats,
      sampledAt: new Date().toISOString(),
    };
  };
  const queue = async (connection) => {
    if (connection.id === "offline") return fault();
    if (state.queueFailure)
      throw new Error(
        "Fixture task query failed; inventory remains available.",
      );
    if (state.empty) return [];
    return Array.from({ length: state.rich ? 14 : 1 }, (_, index) => ({
      id: index === 0 ? "task" : "task-" + index,
      title:
        index === 0
          ? "Verify native pinned TLS pairing"
          : `Task ${index}: review work and report the complete outcome`,
      status: index % 2 ? "pending" : "active",
      destination: index === 0 ? "builder" : `agent-${index}@Secure test rig`,
      priority: index % 3,
      fieldsElided: true,
      summary: "List summary only; open full details.",
    }));
  };
  const readTask = async (_c, id) => ({
    qitemId: id,
    state: "active",
    destinationSession: "builder@Secure test rig",
    sourceSession: "reviewer@Secure test rig",
    priority: 2,
    tsCreated: "2026-10-27T12:00:00Z",
    tsUpdated: "2026-10-27T12:30:00Z",
    humanIntent:
      "Full intent: test Unicode café ✓ 📱 and preserve all information.",
    body:
      "Full task description that is not in the list summary.\nSecond paragraph with expected output and acceptance criteria.\n" +
      "Detailed context. ".repeat(state.rich ? 80 : 1),
    tags: ["mobile", "regression"],
    blockedOn: [],
    fieldsElided: false,
  });
  return {
    state,
    receipts,
    connections,
    activeConnection: async () => "fixture",
    readTask,
    backend: {
      validateConnection: () => {},
      inventory,
      queue,
      quote: (value) => "'" + value + "'",
      sessionCommand: () => {},
      remote: async (_c, command) => {
        if (state.screenFailure)
          throw new Error("Fixture pane temporarily unavailable.");
        receipts.push({ op: "screen", command });
        return (
          `Pinned TLS verified. Fixture terminal, no live agent.\nSession revision ${state.sessionRevision}\n` +
          (state.rich
            ? Array.from(
                { length: 200 },
                (_, i) =>
                  `Line ${i}: terminal output café ✓ with a long line ${"x".repeat(80)}`,
              ).join("\n")
            : "")
        );
      },
    },
    runRig: async (_c, args) => {
      if (state.messageFailure)
        throw new Error("Fixture message could not be delivered.");
      receipts.push({ op: "message", args });
      return "sent";
    },
  };
}
module.exports = { mobileScenario };
